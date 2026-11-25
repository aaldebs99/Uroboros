import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { Export } from "@uroboros/contract";
import { pino } from "pino";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { liveJobs } from "../../test/jobs.ts";
import { seedEntry, type SeededEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";
import { exportJobKey, exportKey } from "./store.ts";

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
    root: await mkdtemp(join(tmpdir(), "uroboros-exports-")),
    layout: DEFAULT_LAYOUT,
  });
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(
    createApp({ db: t.db, version: "t", logger, store, downloads: h.ctx }, { webDist: null }),
    s,
  );
const user = () => signedIn(t.db, { username: `ex${String(++n)}` });
const post = (a: OpenAPIHono, path: string) => a.request(path, { method: "POST" });

const SEGMENTS = [
  { start: 10, end: 20, category: "sponsor" },
  { start: 19.8, end: 25, category: "selfpromo" },
  { start: 80, end: 90, category: "sponsor" },
];

/** An entry of `owner`'s whose file keeps `segments` for the player to skip. */
async function entryWith(owner: SignedIn, segments: unknown[] = SEGMENTS): Promise<SeededEntry> {
  const e = await seedEntry(t.db, owner.userId, { title: `Film ${String(++n)}` });
  await t.db
    .updateTable("renditions")
    .set({ skip_segments: JSON.stringify(segments) })
    .where("id", "=", e.renditionId)
    .execute();
  return e;
}

describe("asking for a copy without sponsors", () => {
  it("queues one job for the merged cuts, and answers a second ask with the same copy", async () => {
    const me = await user();
    const e = await entryWith(me);
    const first = await post(app(me), `/api/library/${e.entryId}/export`);
    expect(first.status).toBe(201);
    const made = Export.parse(await first.json());
    expect(made).toMatchObject({
      entryId: e.entryId,
      state: "queued",
      progress: null,
      cutSeconds: 25,
      keptSeconds: 75,
      fileUrl: null,
    });
    const row = await t.db
      .selectFrom("exports")
      .select("cuts")
      .where("id", "=", made.id)
      .executeTakeFirstOrThrow();
    expect(row.cuts).toEqual([
      { start: 10, end: 25 },
      { start: 80, end: 90 },
    ]);
    const again = await post(app(me), `/api/library/${e.entryId}/export`);
    expect(again.status).toBe(200);
    expect(Export.parse(await again.json()).id).toBe(made.id);
    const jobs = (await liveJobs(t.db, "export")).filter((j) => j.key === exportJobKey(made.id));
    expect(jobs).toEqual([expect.objectContaining({ data: { exportId: made.id } })]);
  });

  it("says a copy is current until the file's segments change, and a new ask is then a new copy", async () => {
    const me = await user();
    const e = await entryWith(me);
    const made = Export.parse(
      await (await post(app(me), `/api/library/${e.entryId}/export`)).json(),
    );
    expect(made.current).toBe(true);
    // A SponsorBlock refetch found other segments.
    await t.db
      .updateTable("renditions")
      .set({ skip_segments: JSON.stringify([{ start: 30, end: 40, category: "sponsor" }]) })
      .where("id", "=", e.renditionId)
      .execute();
    const list = z.array(Export).parse(await (await app(me).request("/api/exports")).json());
    expect(list.find((c) => c.id === made.id)?.current).toBe(false);
    const again = await post(app(me), `/api/library/${e.entryId}/export`);
    expect(again.status).toBe(201);
    const fresh = Export.parse(await again.json());
    expect(fresh.id).not.toBe(made.id);
    expect(fresh).toMatchObject({ current: true, cutSeconds: 10 });
  });

  it("makes a failed copy again in its own row when asked again", async () => {
    const me = await user();
    const e = await entryWith(me);
    const made = Export.parse(
      await (await post(app(me), `/api/library/${e.entryId}/export`)).json(),
    );
    await t.db.deleteFrom("jobs").where("key", "=", exportJobKey(made.id)).execute();
    await t.db
      .updateTable("exports")
      .set({ state: "failed", error: "boom", progress: 0.4, finished_at: new Date() })
      .where("id", "=", made.id)
      .execute();
    const again = await post(app(me), `/api/library/${e.entryId}/export`);
    expect(again.status).toBe(201);
    expect(Export.parse(await again.json())).toMatchObject({
      id: made.id,
      state: "queued",
      error: null,
      progress: null,
    });
    const rows = await t.db
      .selectFrom("exports")
      .select("id")
      .where("entry_id", "=", e.entryId)
      .execute();
    expect(rows).toHaveLength(1);
    const jobs = (await liveJobs(t.db, "export")).filter((j) => j.key === exportJobKey(made.id));
    expect(jobs).toHaveLength(1);
  });

  it("refuses a video with nothing to cut, and someone else's entry", async () => {
    const [me, other] = [await user(), await user()];
    const plain = await entryWith(me, []);
    const res = await post(app(me), `/api/library/${plain.entryId}/export`);
    expect(res.status).toBe(400);
    const theirs = await entryWith(other);
    expect((await post(app(me), `/api/library/${theirs.entryId}/export`)).status).toBe(404);
  });

  it("makes one for an entry shared with the caller, as their own copy", async () => {
    const [owner, friend] = [await user(), await user()];
    const e = await entryWith(owner);
    const share = await t.db
      .insertInto("shares")
      .values({ owner_id: owner.userId, entry_id: e.entryId, mode: "people" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto("share_people")
      .values({ share_id: share.id, user_id: friend.userId })
      .execute();
    const res = await post(app(friend), `/api/library/${e.entryId}/export`);
    expect(res.status).toBe(201);
    const list = z.array(Export).parse(await (await app(owner).request("/api/exports")).json());
    expect(list).toEqual([]);
  });
});

describe("a copy's cuts follow its person's SponsorBlock setting (docs/automation.md#sponsorblock)", () => {
  /** `who` skips `skip` (and shows nothing else) in videos and audio files alike. */
  async function skipping(who: SignedIn, skip: string[]) {
    const columns = {
      sponsorblock_video_show: skip,
      sponsorblock_video_skip: skip,
      sponsorblock_audio_show: skip,
      sponsorblock_audio_skip: skip,
    };
    await t.db
      .insertInto("user_preferences")
      .values({ user_id: who.userId, ...columns })
      .onConflict((oc) => oc.column("user_id").doUpdateSet(columns))
      .execute();
  }
  const STORED = [
    { start: 10, end: 20, category: "sponsor" },
    { start: 30, end: 40, category: "intro" },
  ];
  const cutsOf = async (id: string) =>
    (await t.db.selectFrom("exports").select("cuts").where("id", "=", id).executeTakeFirstOrThrow())
      .cuts;

  it("cuts the segments the requester skips, not every stored one", async () => {
    const me = await user();
    await skipping(me, ["sponsor"]);
    const e = await entryWith(me, STORED);
    const made = Export.parse(
      await (await post(app(me), `/api/library/${e.entryId}/export`)).json(),
    );
    expect(await cutsOf(made.id)).toEqual([{ start: 10, end: 20 }]);
  });

  it("gives two people with different settings different copies of one entry", async () => {
    const [owner, friend] = [await user(), await user()];
    await skipping(owner, ["sponsor"]);
    await skipping(friend, ["intro"]);
    const e = await entryWith(owner, STORED);
    const share = await t.db
      .insertInto("shares")
      .values({ owner_id: owner.userId, entry_id: e.entryId, mode: "people" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto("share_people")
      .values({ share_id: share.id, user_id: friend.userId })
      .execute();
    const mine = Export.parse(
      await (await post(app(owner), `/api/library/${e.entryId}/export`)).json(),
    );
    const theirs = Export.parse(
      await (await post(app(friend), `/api/library/${e.entryId}/export`)).json(),
    );
    expect(await cutsOf(mine.id)).toEqual([{ start: 10, end: 20 }]);
    expect(await cutsOf(theirs.id)).toEqual([{ start: 30, end: 40 }]);
  });

  it("stops being current when its person's setting changes", async () => {
    const me = await user();
    await skipping(me, ["sponsor"]);
    const e = await entryWith(me, STORED);
    const made = Export.parse(
      await (await post(app(me), `/api/library/${e.entryId}/export`)).json(),
    );
    expect(made.current).toBe(true);
    await skipping(me, ["intro", "sponsor"]);
    const list = z.array(Export).parse(await (await app(me).request("/api/exports")).json());
    expect(list.find((c) => c.id === made.id)?.current).toBe(false);
  });

  it("refuses an entry with nothing its person skips (400)", async () => {
    const me = await user();
    const e = await entryWith(me, [{ start: 30, end: 40, category: "intro" }]);
    expect((await post(app(me), `/api/library/${e.entryId}/export`)).status).toBe(400);
  });

  it("clips a segment past the file's end, and refuses cuts covering the whole file", async () => {
    const me = await user();
    const past = await entryWith(me, [{ start: 90, end: 150, category: "sponsor" }]);
    const made = Export.parse(
      await (await post(app(me), `/api/library/${past.entryId}/export`)).json(),
    );
    expect(await cutsOf(made.id)).toEqual([{ start: 90, end: 100 }]);
    const whole = await entryWith(me, [{ start: 0, end: 100, category: "sponsor" }]);
    expect((await post(app(me), `/api/library/${whole.entryId}/export`)).status).toBe(400);
  });
});

describe("a copy's format (docs/transcoding.md)", () => {
  /** An entry of `me`'s whose file is `container`, with or without video, and one skipped segment. */
  async function fileOf(me: SignedIn, container: string, videoCodec: string | null) {
    const e = await entryWith(me);
    await t.db
      .updateTable("renditions")
      .set({ container, video_codec: videoCodec })
      .where("id", "=", e.renditionId)
      .execute();
    return e;
  }
  const formatOf = async (id: string) =>
    (
      await t.db
        .selectFrom("exports")
        .select("format")
        .where("id", "=", id)
        .executeTakeFirstOrThrow()
    ).format;

  it("is MP4 for a video, and the audio file's own container for audio", async () => {
    const me = await user();
    const video = await fileOf(me, "webm", "vp9");
    const audio = await fileOf(me, "mp3", null);
    const v = Export.parse(
      await (await post(app(me), `/api/library/${video.entryId}/export`)).json(),
    );
    const a = Export.parse(
      await (await post(app(me), `/api/library/${audio.entryId}/export`)).json(),
    );
    expect(await formatOf(v.id)).toBe("mp4");
    expect(await formatOf(a.id)).toBe("mp3");
  });

  it("refuses an audio file in a container a copy can't write (400)", async () => {
    const me = await user();
    const e = await fileOf(me, "wma", null);
    const res = await post(app(me), `/api/library/${e.entryId}/export`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("wma");
  });

  it("serves an audio copy as '<title> (no sponsors).mp3', as audio/mpeg", async () => {
    const me = await user();
    const e = await fileOf(me, "mp3", null);
    const made = Export.parse(
      await (await post(app(me), `/api/library/${e.entryId}/export`)).json(),
    );
    const src = join(await mkdtemp(join(tmpdir(), "uroboros-exports-src-")), "copy.mp3");
    await writeFile(src, "ID3");
    await store.put(exportKey(made.id, "mp3"), src, "audio/mpeg");
    await t.db
      .updateTable("exports")
      .set({
        state: "done",
        progress: 1,
        storage_key: exportKey(made.id, "mp3"),
        size_bytes: 3,
        finished_at: new Date(),
      })
      .where("id", "=", made.id)
      .execute();
    const file = await app(me).request(`/api/exports/${made.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("audio/mpeg");
    expect(file.headers.get("content-disposition")).toContain("(no%20sponsors).mp3");
  });
});

describe("a copy once made", () => {
  async function finished(me: SignedIn) {
    const e = await entryWith(me);
    const made = Export.parse(
      await (await post(app(me), `/api/library/${e.entryId}/export`)).json(),
    );
    const src = join(await mkdtemp(join(tmpdir(), "uroboros-exports-src-")), "copy.mp4");
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
    return made;
  }

  it("lists with a file to save, and serves it to its person only", async () => {
    const [me, other] = [await user(), await user()];
    const made = await finished(me);
    const list = z.array(Export).parse(await (await app(me).request("/api/exports")).json());
    expect(list[0]).toMatchObject({
      id: made.id,
      state: "done",
      sizeBytes: 10,
      fileUrl: `/api/exports/${made.id}/file`,
    });
    const file = await app(me).request(`/api/exports/${made.id}/file`);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("0123456789");
    expect(file.headers.get("content-disposition")).toContain("(no%20sponsors).mp4");
    expect((await app(other).request(`/api/exports/${made.id}/file`)).status).toBe(404);
  });

  it("is not served before it is done", async () => {
    const me = await user();
    const e = await entryWith(me);
    const made = Export.parse(
      await (await post(app(me), `/api/library/${e.entryId}/export`)).json(),
    );
    expect((await app(me).request(`/api/exports/${made.id}/file`)).status).toBe(404);
  });

  it("is removed by its person, which trashes its file", async () => {
    const [me, other] = [await user(), await user()];
    const made = await finished(me);
    const del = (s: SignedIn) => app(s).request(`/api/exports/${made.id}`, { method: "DELETE" });
    expect((await del(other)).status).toBe(404);
    expect((await del(me)).status).toBe(204);
    const trash = await t.db
      .selectFrom("storage_trash")
      .select("key")
      .where("key", "=", exportKey(made.id, "mp4"))
      .execute();
    expect(trash).toHaveLength(1);
    expect((await app(me).request(`/api/exports/${made.id}/file`)).status).toBe(404);
  });
});
