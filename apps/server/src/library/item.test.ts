import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryItem, TagsBody } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";

const logger = pino({ level: "silent" });
let testDb: TestDb;
let store: MediaStore;
let alice: SignedIn;
let bob: SignedIn;
let entryId: string;
let subId: string;
let otherSubId: string;

beforeAll(async () => {
  testDb = await TestDb.create();
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-item-")),
    layout: DEFAULT_LAYOUT,
  });
  const src = join(await mkdtemp(join(tmpdir(), "uroboros-item-src-")), "f");
  await writeFile(src, "0123456789");
  await store.put("v.mp4", src, "video/mp4");
  await writeFile(src, "WEBVTT\n");
  await store.put("v.en.vtt", src, "text/vtt");
  alice = await signedIn(testDb.db, { username: "ialice" });
  bob = await signedIn(testDb.db, { username: "ibob" });
  const p = await seededDefault(testDb.db);
  const media = await testDb.db
    .insertInto("media")
    .values({
      extractor: "youtube",
      video_id: "item1",
      title: "Big Buck Bunny",
      description: "An open movie",
      duration: 100,
      webpage_url: "https://www.youtube.com/watch?v=item1",
      chapters: JSON.stringify([{ start: 0, end: 50, title: "Intro" }]),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const other = await testDb.db
    .insertInto("media")
    .values({ extractor: "youtube", video_id: "item2" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const r = await testDb.db
    .insertInto("renditions")
    .values({
      media_id: media.id,
      profile_id: p.id,
      profile_revision: p.revision,
      storage_key: "v.mp4",
      size_bytes: 10,
      container: "mp4",
      video_codec: "h264",
      audio_codec: "aac",
      width: 1280,
      height: 720,
      video_codecs: "avc1.64001f",
      audio_codecs: "mp4a.40.2",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  entryId = (
    await testDb.db
      .insertInto("library_entries")
      .values({ user_id: alice.userId, media_id: media.id, rendition_id: r.id })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
  subId = (
    await testDb.db
      .insertInto("subtitles")
      .values({ media_id: media.id, lang: "en", storage_key: "v.en.vtt" })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
  otherSubId = (
    await testDb.db
      .insertInto("subtitles")
      .values({ media_id: other.id, lang: "en", storage_key: `x/${randomUUID()}.vtt` })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
  const s = await testDb.db
    .insertInto("sources")
    .values({
      extractor: "youtubetab",
      source_id: "PLi",
      kind: "playlist",
      title: "Mix",
      url: "https://x.example/p",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await testDb.db
    .insertInto("user_sources")
    .values({ user_id: alice.userId, source_id: s.id })
    .execute();
  await testDb.db
    .insertInto("source_items")
    .values({ source_id: s.id, extractor: "youtube", video_id: "item1", position: 0 })
    .execute();
});
afterAll(async () => {
  await testDb.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: testDb.db, version: "t", logger, store }, { webDist: null }), s);

const put = (s: SignedIn, path: string, json: unknown) =>
  app(s).request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(json),
  });

const item = async (s: SignedIn = alice) =>
  LibraryItem.parse(await (await app(s).request(`/api/library/${entryId}`)).json());

describe("library item", () => {
  it("gives the item with chapters, subtitles, sources and the stream URL", async () => {
    const it2 = await item();
    expect(it2).toMatchObject({
      title: "Big Buck Bunny",
      description: "An open movie",
      chapters: [{ start: 0, end: 50, title: "Intro" }],
      subtitles: [
        {
          id: subId,
          lang: "en",
          automatic: false,
          url: `/api/library/${entryId}/subtitles/${subId}`,
        },
      ],
      streamUrl: `/api/library/${entryId}/stream`,
      webpageUrl: "https://www.youtube.com/watch?v=item1",
      sources: [{ title: "Mix" }],
    });
  });

  it("says what the player needs to choose: codec strings, size and the qualities offered", async () => {
    expect(await item()).toMatchObject({
      videoCodecs: "avc1.64001f",
      audioCodecs: "mp4a.40.2",
      width: 1280,
      height: 720,
      qualities: ["720", "480", "360"],
    });
  });

  it("streams inline with ranges, and serves the subtitle as text/vtt", async () => {
    const res = await app(alice).request(`/api/library/${entryId}/stream`, {
      headers: { range: "bytes=2-4" },
    });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("234");
    expect(res.headers.get("content-disposition")).toBeNull();
    const sub = await app(alice).request(`/api/library/${entryId}/subtitles/${subId}`);
    expect(sub.headers.get("content-type")).toBe("text/vtt");
    expect(await sub.text()).toBe("WEBVTT\n");
    expect(
      (await app(alice).request(`/api/library/${entryId}/subtitles/${otherSubId}`)).status,
    ).toBe(404);
  });

  it("keeps watched once past 90%, clamps a position past the end, and resets on unwatch", async () => {
    for (const position of [50, 95, 40]) {
      expect(
        (await put(alice, `/api/library/${entryId}/progress`, { position, duration: 100 })).status,
      ).toBe(204);
    }
    expect((await item()).progress).toEqual({ position: 40, duration: 100, watched: true });
    await put(alice, `/api/library/${entryId}/progress`, { position: 500, duration: 100 });
    expect((await item()).progress?.position).toBe(100);
    await put(alice, `/api/library/${entryId}/watched`, { watched: false });
    expect((await item()).progress).toEqual({ position: 0, duration: 100, watched: false });
    await put(alice, `/api/library/${entryId}/watched`, { watched: true });
    expect((await item()).progress?.watched).toBe(true);
  });

  it("stamps watched_at once and clears it on unwatch", async () => {
    const watchedAt = async () => {
      const row = await testDb.db
        .selectFrom("watch_progress")
        .innerJoin("library_entries as e", "e.media_id", "watch_progress.media_id")
        .select("watch_progress.watched_at")
        .where("e.id", "=", entryId)
        .where("watch_progress.user_id", "=", alice.userId)
        .executeTakeFirstOrThrow();
      return row.watched_at;
    };
    await put(alice, `/api/library/${entryId}/watched`, { watched: false });
    expect(await watchedAt()).toBeNull();
    await put(alice, `/api/library/${entryId}/progress`, { position: 95, duration: 100 });
    const first = await watchedAt();
    expect(first).not.toBeNull();
    await put(alice, `/api/library/${entryId}/progress`, { position: 99, duration: 100 });
    await put(alice, `/api/library/${entryId}/watched`, { watched: true });
    expect(await watchedAt()).toEqual(first);
    await put(alice, `/api/library/${entryId}/watched`, { watched: false });
    expect(await watchedAt()).toBeNull();
    await put(alice, `/api/library/${entryId}/watched`, { watched: true });
    expect(await watchedAt()).not.toBeNull();
  });

  it("sets and clears kept (204)", async () => {
    expect((await item()).kept).toBe(false);
    expect((await put(alice, `/api/library/${entryId}/kept`, { kept: true })).status).toBe(204);
    expect((await item()).kept).toBe(true);
    await put(alice, `/api/library/${entryId}/kept`, { kept: false });
    expect((await item()).kept).toBe(false);
    expect((await put(bob, `/api/library/${entryId}/kept`, { kept: true })).status).toBe(404);
  });

  it("replaces and normalizes tags", async () => {
    const res = await put(alice, `/api/library/${entryId}/tags`, {
      tags: ["Music", " live ", "music"],
    });
    expect(TagsBody.parse(await res.json())).toEqual({ tags: ["live", "music"] });
    expect((await item()).tags).toEqual(["live", "music"]);
    await put(alice, `/api/library/${entryId}/tags`, { tags: [] });
    expect((await item()).tags).toEqual([]);
  });

  it("answers 404 for another person on every route", async () => {
    for (const [method, path, body] of [
      ["GET", `/api/library/${entryId}`, undefined],
      ["GET", `/api/library/${entryId}/stream`, undefined],
      ["GET", `/api/library/${entryId}/subtitles/${subId}`, undefined],
      ["PUT", `/api/library/${entryId}/progress`, { position: 1, duration: 2 }],
      ["PUT", `/api/library/${entryId}/watched`, { watched: true }],
      ["PUT", `/api/library/${entryId}/tags`, { tags: [] }],
    ] as const) {
      const res = await app(bob).request(path, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }
  });
});

describe("content security policy", () => {
  it("lets the player load media from the S3 public URL when one is set", async () => {
    const res = await createApp(
      { db: testDb.db, version: "t", logger },
      { webDist: null, mediaOrigins: ["https://media.example.org"] },
    ).request("/api/health");
    expect(res.headers.get("content-security-policy")).toContain(
      "media-src 'self' blob: https://media.example.org",
    );
  });
});
