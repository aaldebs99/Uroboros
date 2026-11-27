import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { ApiErrorBody, Export } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { liveJobs } from "../../test/jobs.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";
import { exportJobKey, exportKey } from "./store.ts";

/** Asking for a clip (docs/sharing.md#clips): a copy of one range of an entry's file (100 s here). */

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let store: MediaStore;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-clips-")),
    layout: DEFAULT_LAYOUT,
  });
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const app = (s: SignedIn, clipsEnabled = true): OpenAPIHono =>
  asUser(
    createApp(
      { db: t.db, version: "t", logger, store, downloads: h.ctx },
      { webDist: null, clipsEnabled },
    ),
    s,
  );
const user = () => signedIn(t.db, { username: `clip${String(++n)}` });
const ask = (a: OpenAPIHono, entryId: string, body?: unknown) =>
  a.request(`/api/library/${entryId}/export`, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
const film = (owner: SignedIn, segments: unknown[] = []) =>
  seedEntry(t.db, owner.userId, { title: `Film ${String(++n)}` }).then(async (e) => {
    await t.db
      .updateTable("renditions")
      .set({ skip_segments: JSON.stringify(segments) })
      .where("id", "=", e.renditionId)
      .execute();
    return e;
  });

describe("asking for a clip", () => {
  it("queues a copy of the range, even of a video with nothing skipped, that is current and keeps its length", async () => {
    const me = await user();
    const e = await film(me);
    const res = await ask(app(me), e.entryId, { clip: { start: 62.12349, end: 90 } });
    expect(res.status).toBe(201);
    const made = Export.parse(await res.json());
    expect(made).toMatchObject({
      entryId: e.entryId,
      state: "queued",
      clip: { start: 62.123, end: 90 },
      keptSeconds: 27.877,
      current: true,
    });
    expect(await liveJobs(t.db, "export")).toContainEqual(
      expect.objectContaining({ key: exportJobKey(made.id) }),
    );
  });

  it("writes the range's complement as cuts, so a worker of the release before makes the same clip", async () => {
    const me = await user();
    const e = await film(me);
    const made = Export.parse(
      await (await ask(app(me), e.entryId, { clip: { start: 20, end: 30 } })).json(),
    );
    const row = await t.db
      .selectFrom("exports")
      .select(["cuts", "clip_start", "clip_end"])
      .where("id", "=", made.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      cuts: [
        { start: 0, end: 20 },
        { start: 30, end: 100 },
      ],
      clip_start: 20,
      clip_end: 30,
    });
  });

  it("answers the same range with the same copy, and another range with another", async () => {
    const me = await user();
    const e = await film(me);
    const first = Export.parse(
      await (await ask(app(me), e.entryId, { clip: { start: 10, end: 20 } })).json(),
    );
    const again = await ask(app(me), e.entryId, { clip: { start: 10, end: 20 } });
    expect(again.status).toBe(200);
    expect(Export.parse(await again.json()).id).toBe(first.id);
    const other = await ask(app(me), e.entryId, { clip: { start: 10, end: 21 } });
    expect(other.status).toBe(201);
    expect(Export.parse(await other.json()).id).not.toBe(first.id);
  });

  it("never answers a clip with a copy without sponsors, or the other way", async () => {
    const me = await user();
    // Cutting 0–10 and 90–100 leaves 10–90: the same as a clip of 10–90, yet not one.
    const e = await film(me, [
      { start: 0, end: 10, category: "sponsor" },
      { start: 90, end: 100, category: "sponsor" },
    ]);
    const sponsorless = Export.parse(await (await ask(app(me), e.entryId)).json());
    const clip = await ask(app(me), e.entryId, { clip: { start: 10, end: 90 } });
    expect(clip.status).toBe(201);
    const made = Export.parse(await clip.json());
    expect(made.id).not.toBe(sponsorless.id);
    expect(sponsorless.clip).toBeNull();
    const again = await ask(app(me), e.entryId);
    expect(Export.parse(await again.json()).id).toBe(sponsorless.id);
  });

  it.each([
    ["one past the end", { start: 90, end: 105 }],
    ["one under a second", { start: 10, end: 10.5 }],
    ["one that ends before it starts", { start: 30, end: 20 }],
  ])("refuses %s (400)", async (_name, clip) => {
    const me = await user();
    const e = await film(me);
    const res = await ask(app(me), e.entryId, { clip });
    expect(res.status).toBe(400);
  });

  it("refuses a clip while clips are off (409), leaving copies without sponsors alone", async () => {
    const me = await user();
    const e = await film(me, [{ start: 10, end: 20, category: "sponsor" }]);
    const res = await ask(app(me, false), e.entryId, { clip: { start: 10, end: 20 } });
    expect(res.status).toBe(409);
    expect(ApiErrorBody.parse(await res.json()).message).toContain("clips are off");
    expect((await ask(app(me, false), e.entryId)).status).toBe(201);
  });

  it("saves a finished clip as '<title> (clip 1m02s–1m30s).mp4', even with clips off since", async () => {
    const me = await user();
    const e = await film(me);
    const made = Export.parse(
      await (await ask(app(me), e.entryId, { clip: { start: 62, end: 90 } })).json(),
    );
    const src = join(await mkdtemp(join(tmpdir(), "uroboros-clips-src-")), "clip.mp4");
    await writeFile(src, "0123456789");
    await store.put(exportKey(made.id, "mp4"), src, "video/mp4");
    await t.db
      .updateTable("exports")
      .set({
        state: "done",
        progress: 1,
        storage_key: exportKey(made.id, "mp4"),
        size_bytes: 10,
        finished_at: new Date(),
      })
      .where("id", "=", made.id)
      .execute();
    const file = await app(me, false).request(`/api/exports/${made.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain(
      encodeURIComponent("(clip 1m02s–1m30s).mp4"),
    );
  });
});
