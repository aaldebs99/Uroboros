import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { EntryRef, LibraryItem, PlaybackSession } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { seedEntry, type SeededEntry } from "../../test/library.ts";
import { testBus } from "../../test/bus.ts";
import type { PgBus } from "../db/notifications.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";
import { createPlaybackBus, type PlaybackBus } from "../transcode/bus.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let store: MediaStore;
let alice: SignedIn;
let bob: SignedIn;
let carol: SignedIn;
let shared: SeededEntry;
let pg: PgBus;
let bus: PlaybackBus;
/** A playback request any browser could make. */
const PLAY = { quality: "original", start: 0, copyVideo: true, copyAudio: true };

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  pg = testBus(t);
  bus = createPlaybackBus(pg, t.db, logger);
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-share-")),
    layout: DEFAULT_LAYOUT,
  });
  const src = join(await mkdtemp(join(tmpdir(), "uroboros-share-src-")), "f");
  await writeFile(src, "0123456789");
  await store.put("shared.mp4", src, "video/mp4");
  alice = await signedIn(t.db, { username: "seralice" });
  bob = await signedIn(t.db, { username: "serbob" });
  carol = await signedIn(t.db, { username: "sercarol" });
  shared = await seedEntry(t.db, alice.userId, { title: "Shared film", storageKey: "shared.mp4" });
  await t.db
    .updateTable("library_entries")
    .set({ kept: true })
    .where("id", "=", shared.entryId)
    .execute();
  await t.db
    .insertInto("entry_tags")
    .values({ entry_id: shared.entryId, tag: "private" })
    .execute();
  const s = await t.db
    .insertInto("shares")
    .values({ owner_id: alice.userId, mode: "people", entry_id: shared.entryId })
    .returning("id")
    .executeTakeFirstOrThrow();
  await t.db.insertInto("share_people").values({ share_id: s.id, user_id: bob.userId }).execute();
});
afterAll(async () => {
  bus.close();
  await pg.close();
  await h.close();
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(
    createApp(
      {
        db: t.db,
        version: "t",
        logger,
        downloads: h.ctx,
        store,
        playbackBus: bus,
      },
      { webDist: null },
    ),
    s,
  );
const send = (s: SignedIn, method: string, path: string, json?: unknown) =>
  app(s).request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });

describe("a video shared with people", () => {
  it("shows the recipient the video without the owner's personal fields", async () => {
    const res = await send(bob, "GET", `/api/library/${shared.entryId}`);
    expect(res.status).toBe(200);
    const item = LibraryItem.parse(await res.json());
    expect(item).toMatchObject({
      title: "Shared film",
      sharedBy: "seralice",
      tags: [],
      kept: false,
      subscription: null,
      sources: [],
      playlists: [],
    });
    const own = LibraryItem.parse(
      await (await send(alice, "GET", `/api/library/${shared.entryId}`)).json(),
    );
    expect(own).toMatchObject({ sharedBy: null, kept: true, tags: ["private"] });
  });

  it("streams it and lets the recipient save it", async () => {
    const stream = await send(bob, "GET", `/api/library/${shared.entryId}/stream`);
    expect(stream.status).toBe(200);
    expect(await stream.text()).toBe("0123456789");
    expect((await send(bob, "GET", `/api/library/${shared.entryId}/file`)).status).toBe(200);
  });

  it("keeps the recipient's progress apart from the owner's", async () => {
    const res = await send(bob, "PUT", `/api/library/${shared.entryId}/progress`, {
      position: 30,
      duration: 100,
    });
    expect(res.status).toBe(204);
    const rows = await t.db
      .selectFrom("watch_progress")
      .select(["user_id", "position_s"])
      .where("media_id", "=", shared.mediaId)
      .execute();
    expect(rows).toEqual([{ user_id: bob.userId, position_s: 30 }]);
    expect(
      (await send(bob, "PUT", `/api/library/${shared.entryId}/watched`, { watched: true })).status,
    ).toBe(204);
  });

  it("starts a playback session on the recipient's behalf", async () => {
    const res = await send(bob, "POST", `/api/library/${shared.entryId}/playback`, PLAY);
    expect(res.status).toBe(201);
    expect(PlaybackSession.parse(await res.json()).masterUrl).toMatch(
      new RegExp(`^/api/library/${shared.entryId}/playback/sessions/[0-9a-f-]+/master\\.m3u8$`),
    );
  });

  it("is 404 to anyone it was not shared with", async () => {
    for (const [method, path] of [
      ["GET", ""],
      ["GET", "/stream"],
      ["GET", "/file"],
      ["GET", "/thumbnail"],
      ["POST", "/playback"],
    ] as const) {
      const body = method === "POST" ? PLAY : undefined;
      expect(
        (await send(carol, method, `/api/library/${shared.entryId}${path}`, body)).status,
      ).toBe(404);
    }
    const progress = await send(carol, "PUT", `/api/library/${shared.entryId}/progress`, {
      position: 1,
      duration: 100,
    });
    expect(progress.status).toBe(404);
  });

  it("keeps Keep, tags and removal to the owner", async () => {
    expect(
      (await send(bob, "PUT", `/api/library/${shared.entryId}/kept`, { kept: false })).status,
    ).toBe(404);
    expect(
      (await send(bob, "PUT", `/api/library/${shared.entryId}/tags`, { tags: ["x"] })).status,
    ).toBe(404);
    expect((await send(bob, "DELETE", `/api/library/${shared.entryId}`)).status).toBe(404);
  });

  it("add to my library is idempotent per rendition", async () => {
    const first = await send(bob, "POST", `/api/library/${shared.entryId}/add`);
    expect(first.status).toBe(201);
    const added = EntryRef.parse(await first.json());
    expect(added.id).not.toBe(shared.entryId);
    const again = await send(bob, "POST", `/api/library/${shared.entryId}/add`);
    expect(again.status).toBe(200);
    expect(EntryRef.parse(await again.json()).id).toBe(added.id);
    const ownAdd = await send(alice, "POST", `/api/library/${shared.entryId}/add`);
    expect(ownAdd.status).toBe(200);
    expect(EntryRef.parse(await ownAdd.json()).id).toBe(shared.entryId);
    expect((await send(carol, "POST", `/api/library/${shared.entryId}/add`)).status).toBe(404);
  });
});
