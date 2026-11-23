import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { LibraryItem, Playback } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness, seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { DEFAULT_LAYOUT } from "../storage/config.ts";
import { createStore, type MediaStore } from "../storage/index.ts";
import { settingsRevision } from "./settings.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let store: MediaStore;
let src: string;
let alice: SignedIn;
let bob: SignedIn;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  store = createStore({
    kind: "filesystem",
    root: await mkdtemp(join(tmpdir(), "uroboros-tc-")),
    layout: DEFAULT_LAYOUT,
  });
  src = join(await mkdtemp(join(tmpdir(), "uroboros-tc-src-")), "f");
  await writeFile(src, "#EXTM3U\n");
  alice = await signedIn(t.db, { username: "tc-alice" });
  bob = await signedIn(t.db, { username: "tc-bob" });
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(
    createApp(
      {
        db: t.db,
        valkey: h.ctx.valkey,
        version: "t",
        logger,
        downloads: h.ctx,
        store,
        transcodeEncoder: "libx264",
      },
      { webDist: null },
    ),
    s,
  );
const get = (s: SignedIn, path: string) => app(s).request(path);
const post = (s: SignedIn, path: string) => app(s).request(path, { method: "POST" });

/** An entry of `userId`'s on a VP9/Opus WebM rendition. */
async function entry(userId: string) {
  const profile = await seededDefault(t.db);
  const m = await t.db
    .insertInto("media")
    .values({ extractor: "youtube", video_id: randomUUID(), duration: 60 })
    .returning("id")
    .executeTakeFirstOrThrow();
  const r = await t.db
    .insertInto("renditions")
    .values({
      media_id: m.id,
      profile_id: profile.id,
      profile_revision: profile.revision,
      storage_key: `media/${m.id}.webm`,
      size_bytes: 10,
      container: "webm",
      video_codec: "vp9",
      audio_codec: "opus",
      duration: 60,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const e = await t.db
    .insertInto("library_entries")
    .values({ user_id: userId, media_id: m.id, rendition_id: r.id })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { entryId: e.id, renditionId: r.id };
}

const copies = (renditionId: string) =>
  t.db
    .selectFrom("transcodes")
    .selectAll()
    .where("source_rendition_id", "=", renditionId)
    .execute();

describe("playback copies", () => {
  it("creates a copy and queues its job", async () => {
    const e = await entry(alice.userId);
    expect((await get(alice, `/api/library/${e.entryId}/playback`)).status).toBe(404);
    const res = await post(alice, `/api/library/${e.entryId}/playback`);
    expect(res.status).toBe(200);
    expect(Playback.parse(await res.json())).toEqual({
      state: "queued",
      mode: null,
      readySegments: 0,
      progress: 0,
      masterUrl: `/api/library/${e.entryId}/playback/master.m3u8`,
      error: null,
    });
    const [row] = await copies(e.renditionId);
    expect(row).toMatchObject({ encoder: "libx264", settings: settingsRevision("libx264") });
    expect(await h.queues.transcode.getJob(`transcode|${row?.id ?? ""}`)).toBeDefined();
    expect((await get(alice, `/api/library/${e.entryId}/playback`)).status).toBe(200);
  });

  it("creates one copy for concurrent requests", async () => {
    const e = await entry(alice.userId);
    const [a, b] = await Promise.all([
      post(alice, `/api/library/${e.entryId}/playback`),
      post(alice, `/api/library/${e.entryId}/playback`),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await copies(e.renditionId)).toHaveLength(1);
  });

  it("retries a failed copy as a new row", async () => {
    const e = await entry(alice.userId);
    await post(alice, `/api/library/${e.entryId}/playback`);
    const [old] = await copies(e.renditionId);
    await t.db
      .updateTable("transcodes")
      .set({ state: "failed", error_message: "boom" })
      .where("id", "=", old?.id ?? "")
      .execute();
    const failed = Playback.parse(
      await (await get(alice, `/api/library/${e.entryId}/playback`)).json(),
    );
    expect(failed).toMatchObject({ state: "failed", error: "boom" });
    await post(alice, `/api/library/${e.entryId}/playback`);
    const [fresh] = await copies(e.renditionId);
    expect(fresh?.id).not.toBe(old?.id);
    expect(fresh?.state).toBe("queued");
    const trash = await t.db.selectFrom("storage_trash").select("key").execute();
    expect(trash.map((r) => r.key)).toContain(`.transcodes/${old?.id ?? ""}/`);
  });

  it("serves the master playlist with the copy's codecs", async () => {
    const e = await entry(alice.userId);
    await post(alice, `/api/library/${e.entryId}/playback`);
    const master = `/api/library/${e.entryId}/playback/master.m3u8`;
    expect((await get(alice, master)).status).toBe(409);
    await t.db
      .updateTable("transcodes")
      .set({ mode: "encode", codecs: "avc1.640028,mp4a.40.2", resolution: "1920x1080", attempt: 2 })
      .where("source_rendition_id", "=", e.renditionId)
      .execute();
    const res = await get(alice, master);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/vnd.apple.mpegurl");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain(
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080',
    );
    expect(body.trim().split("\n").at(-1)).toBe("2/index.m3u8");
  });

  it("serves the stored playlist and segments of the current attempt only", async () => {
    const e = await entry(alice.userId);
    await post(alice, `/api/library/${e.entryId}/playback`);
    const [row] = await copies(e.renditionId);
    const id = row?.id ?? "";
    await t.db.updateTable("transcodes").set({ attempt: 2 }).where("id", "=", id).execute();
    await store.put(`.transcodes/${id}/2/index.m3u8`, src, "application/vnd.apple.mpegurl");
    await store.put(`.transcodes/${id}/2/seg-00001.m4s`, src, "video/mp4");
    const base = `/api/library/${e.entryId}/playback`;
    const playlist = await get(alice, `${base}/2/index.m3u8`);
    expect(playlist.status).toBe(200);
    expect(playlist.headers.get("cache-control")).toBe("no-store");
    expect((await get(alice, `${base}/1/index.m3u8`)).status).toBe(404);
    const seg = await get(alice, `${base}/2/seg-00001.m4s`);
    expect(seg.status).toBe(200);
    expect(seg.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(seg.headers.get("content-type")).toBe("video/mp4");
    expect((await get(alice, `${base}/2/seg-00002.m4s`)).status).toBe(404);
  });

  it("refuses any file but init.mp4 and seg-NNNNN.m4s", async () => {
    const e = await entry(alice.userId);
    await post(alice, `/api/library/${e.entryId}/playback`);
    const base = `/api/library/${e.entryId}/playback/1`;
    for (const name of ["index.m4s", "seg-1.m4s", "..%2Finit.mp4", "init.mp4.bak"]) {
      expect((await get(alice, `${base}/${name}`)).status).toBe(404);
    }
  });

  it("another person's entry is 404 on every playback route", async () => {
    const e = await entry(alice.userId);
    await post(alice, `/api/library/${e.entryId}/playback`);
    const base = `/api/library/${e.entryId}/playback`;
    expect((await post(bob, base)).status).toBe(404);
    for (const path of [
      base,
      `${base}/master.m3u8`,
      `${base}/1/index.m3u8`,
      `${base}/1/init.mp4`,
    ]) {
      expect((await get(bob, path)).status).toBe(404);
    }
  });

  it("gives the item's file codecs and the playback URL", async () => {
    const e = await entry(alice.userId);
    const item = LibraryItem.parse(await (await get(alice, `/api/library/${e.entryId}`)).json());
    expect(item).toMatchObject({
      container: "webm",
      videoCodec: "vp9",
      audioCodec: "opus",
      playbackUrl: `/api/library/${e.entryId}/playback`,
    });
  });
});
