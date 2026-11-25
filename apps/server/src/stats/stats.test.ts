import { randomUUID } from "node:crypto";
import { AdminStats } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { adminStats } from "./stats.ts";

const logger = pino({ level: "silent" });
const DAY = 86_400_000;
let t: TestDb;
let root: SignedIn;
let ann: SignedIn;
let ben: SignedIn;

/** A media row with one stored file of `bytes`, and its sidecars' sizes. */
async function stored(file: {
  bytes: number;
  container: string;
  audio?: boolean;
  extras?: { thumbnail?: number | null; info?: number; preview?: number; subtitle?: number };
}) {
  const profile = await seededDefault(t.db);
  const id = randomUUID();
  const extras = file.extras ?? {};
  await t.db
    .insertInto("media")
    .values({
      id,
      extractor: "youtube",
      video_id: id,
      ...(extras.thumbnail === undefined
        ? {}
        : { thumbnail_key: `${id}/t.jpg`, thumbnail_bytes: extras.thumbnail }),
      ...(extras.info === undefined ? {} : { info_key: `${id}/i.json`, info_bytes: extras.info }),
      ...(extras.preview === undefined
        ? {}
        : { preview_key: `${id}/p.mp4`, preview_bytes: extras.preview }),
    })
    .execute();
  if (extras.subtitle !== undefined) {
    await t.db
      .insertInto("subtitles")
      .values({
        media_id: id,
        lang: "en",
        storage_key: `${id}/en.vtt`,
        size_bytes: extras.subtitle,
      })
      .execute();
  }
  const r = await t.db
    .insertInto("renditions")
    .values({
      media_id: id,
      profile_id: profile.id,
      profile_revision: profile.revision,
      storage_key: `${id}/file.${file.container}`,
      size_bytes: file.bytes,
      container: file.container,
      video_codec: file.audio === true ? null : "h264",
      audio_codec: "aac",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { mediaId: id, renditionId: r.id };
}

async function entry(who: SignedIn, file: { mediaId: string; renditionId: string }, ago: number) {
  const e = await t.db
    .insertInto("library_entries")
    .values({
      user_id: who.userId,
      media_id: file.mediaId,
      rendition_id: file.renditionId,
      added_at: new Date(Date.now() - ago * DAY),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return e.id;
}

let shared: { mediaId: string; renditionId: string };

beforeAll(async () => {
  t = await TestDb.create();
  root = await signedIn(t.db, { username: "stroot", role: "admin" });
  ann = await signedIn(t.db, { username: "stann" });
  ben = await signedIn(t.db, { username: "stben" });
  // A video both have, Ann first; its thumbnail, info, preview and subtitles count with it.
  shared = await stored({
    bytes: 100,
    container: "mp4",
    extras: { thumbnail: 5, info: 3, preview: 4, subtitle: 1 },
  });
  await entry(ann, shared, 3);
  await entry(ben, shared, 1);
  await entry(ann, await stored({ bytes: 30, container: "M4A", audio: true }), 2);
  // Ben's own video, its thumbnail not measured yet, a copy he saved, and an upload underway.
  const own = await stored({ bytes: 50, container: "webm", extras: { thumbnail: null } });
  await t.db
    .updateTable("media")
    .set({ thumbnail_key: `${own.mediaId}/t.jpg`, thumbnail_bytes: null })
    .where("id", "=", own.mediaId)
    .execute();
  const benOwn = await entry(ben, own, 1);
  await t.db
    .insertInto("exports")
    .values({
      user_id: ben.userId,
      entry_id: benOwn,
      rendition_id: own.renditionId,
      cuts: "[]",
      state: "done",
      storage_key: `.exports/${randomUUID()}.mp4`,
      size_bytes: 20,
      finished_at: new Date(),
    })
    .execute();
  const upload = await t.db
    .insertInto("uploads")
    .values({
      user_id: ben.userId,
      filename: "home.mp4",
      size_bytes: 16,
      part_bytes: 8,
      ext: "mp4",
      title: "Home",
      creator: "Ben",
      storage_key: `uploads/${randomUUID()}.mp4`,
      store_upload_id: "u1",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await t.db
    .insertInto("upload_parts")
    .values({ upload_id: upload.id, n: 1, size_bytes: 8, etag: "e" })
    .execute();
  // Someone watching through a playback session: its segments are a cache, nobody's.
  const session = await t.db
    .insertInto("playback_sessions")
    .values({
      rendition_id: own.renditionId,
      entry_id: benOwn,
      user_id: ben.userId,
      quality: "720p",
      mode: "encode",
      plan: "{}",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await t.db
    .insertInto("playback_segments")
    .values({ session_id: session.id, n: 0, size_bytes: 9 })
    .execute();
  // A file nobody has any more, waiting out the reaper's day, with its media's thumbnail.
  await stored({ bytes: 7, container: "mp4", extras: { thumbnail: 2 } });
});
afterAll(async () => {
  await t.close();
});

const app = (s: SignedIn) =>
  asUser(createApp({ db: t.db, version: "t", logger }, { webDist: null }), s);

describe("Admin › Stats", () => {
  it("counts the stored files, videos and audio apart, and by container", async () => {
    const stats = await adminStats(t.db);
    expect(stats.files).toEqual({ total: 4, videos: 3, audio: 1, bytes: 187 });
    expect(stats.containers).toEqual([
      { container: "mp4", files: 2, bytes: 107 },
      { container: "webm", files: 1, bytes: 50 },
      { container: "m4a", files: 1, bytes: 30 },
    ]);
  });

  it("adds up everything stored, by kind, and says how many files wait to be measured", async () => {
    const { storage } = await adminStats(t.db);
    expect(Object.fromEntries(storage.parts.map((p) => [p.kind, p.bytes]))).toEqual({
      files: 187,
      thumbnails: 7,
      info: 3,
      previews: 4,
      subtitles: 1,
      exports: 20,
      uploads: 8,
      playback: 9,
    });
    expect(storage.total).toBe(239);
    expect(storage.unmeasured).toBe(1);
  });

  it("counts a shared file for whoever had it first, so everyone's adds up", async () => {
    const stats = await adminStats(t.db);
    const by = Object.fromEntries(stats.people.map((p) => [p.userId, p]));
    // Ann had the shared video first: it and its media's files are hers, as is her audio.
    expect(by[ann.userId]).toMatchObject({ items: 2, videos: 1, audio: 1, bytes: 100 + 13 + 30 });
    // Ben: his own video, the copy he saved and the upload underway.
    expect(by[ben.userId]).toMatchObject({ items: 2, videos: 2, audio: 0, bytes: 50 + 20 + 8 });
    expect(by[root.userId]).toMatchObject({ items: 0, bytes: 0, displayName: "stroot" });
    expect(stats.people.map((p) => p.userId)).toEqual([ann.userId, ben.userId, root.userId]);
    expect(stats.unclaimed).toEqual({ files: 1, bytes: 9 });
    const people = stats.people.reduce((sum, p) => sum + p.bytes, 0);
    const playback = stats.storage.parts.find((p) => p.kind === "playback")?.bytes ?? 0;
    expect(people + stats.unclaimed.bytes + playback).toBe(stats.storage.total);
  });

  it("passes a shared file on to the next person when the first one removes it", async () => {
    await t.db
      .deleteFrom("library_entries")
      .where("user_id", "=", ann.userId)
      .where("rendition_id", "=", shared.renditionId)
      .execute();
    const by = Object.fromEntries((await adminStats(t.db)).people.map((p) => [p.userId, p]));
    expect(by[ann.userId]).toMatchObject({ items: 1, bytes: 30 });
    expect(by[ben.userId]).toMatchObject({ items: 2, bytes: 78 + 113 });
  });

  it("counts a file two people's downloads brought together for whoever asked first", async () => {
    const both = await stored({ bytes: 1000, container: "mkv" });
    const profile = await seededDefault(t.db);
    const at = new Date(Date.now() - 5 * DAY);
    // Ann's entry would win on its id alone; Ben asked a minute before her.
    for (const [who, ago, entryId] of [
      [ben, 2, "ffffffff-ffff-4fff-bfff-ffffffffffff"],
      [ann, 1, "00000000-0000-4000-8000-000000000001"],
    ] as const) {
      await t.db
        .insertInto("library_entries")
        .values({
          id: entryId,
          user_id: who.userId,
          media_id: both.mediaId,
          rendition_id: both.renditionId,
          added_at: at,
        })
        .execute();
      await t.db
        .insertInto("downloads")
        .values({
          user_id: who.userId,
          profile_id: profile.id,
          profile_revision: profile.revision,
          args: "[]",
          fetch_key: `stats|${both.mediaId}`,
          extractor: "youtube",
          video_id: both.mediaId,
          url: "https://example.com/v",
          state: "done",
          rendition_id: both.renditionId,
          created_at: new Date(Date.now() - (5 * DAY + ago * 60_000)),
        })
        .execute();
    }
    const by = Object.fromEntries((await adminStats(t.db)).people.map((p) => [p.userId, p]));
    expect(by[ben.userId]?.bytes).toBe(78 + 113 + 1000);
    expect(by[ann.userId]?.bytes).toBe(30);
  });

  it("answers admins only", async () => {
    const res = await app(root).request("/api/admin/stats");
    expect(res.status).toBe(200);
    expect(AdminStats.parse(await res.json()).files.total).toBe(5);
    expect((await app(ann).request("/api/admin/stats")).status).toBe(403);
  });
});
