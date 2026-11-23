import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scenario, Step } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { sleep } from "../../test/listings.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { MediaStore } from "../storage/index.ts";
import { settingsRevision } from "../transcode/settings.ts";
import type { WorkerDeps } from "./deps.ts";
import { transcodeProcessor } from "./transcode.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let userId: string;
let src: string;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db);
  userId = (await signedIn(t.db, { username: "transcoder" })).userId;
  src = join(await mkdtemp(join(tmpdir(), "uroboros-tc-src-")), "in.webm");
  await writeFile(src, "media");
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const vp9 = {
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "vp9",
      width: 3840,
      height: 2160,
      pix_fmt: "yuv420p",
    },
    { index: 1, codec_type: "audio", codec_name: "opus", channels: 2 },
  ],
  format: { format_name: "matroska,webm", duration: "12.0" },
};
const h264 = {
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "h264",
      width: 1280,
      height: 720,
      pix_fmt: "yuv420p",
    },
    { index: 1, codec_type: "audio", codec_name: "aac", channels: 2 },
  ],
  format: { format_name: "matroska,webm", duration: "12.0" },
};
const opus = {
  streams: [{ index: 0, codec_type: "audio", codec_name: "opus", channels: 2 }],
  format: { format_name: "ogg", duration: "12.0" },
};
const hdr = {
  ...vp9,
  streams: [
    { ...vp9.streams[0], pix_fmt: "yuv420p10le", color_transfer: "smpte2084" },
    vp9.streams[1],
  ],
};

const playlist = (segments: number, end: boolean) =>
  [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-TARGETDURATION:6",
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:EVENT",
    '#EXT-X-MAP:URI="init.mp4"',
    ...Array.from({ length: segments }, (_, i) => [
      "#EXTINF:6.000000,",
      `seg-${String(i + 1).padStart(5, "0")}.m4s`,
    ]).flat(),
    ...(end ? ["#EXT-X-ENDLIST"] : []),
    "",
  ].join("\n");

/** ffmpeg writing two 6 s segments, with `pause` ms between them. */
const twoSegments = (pause = 50, extra: Step[] = []): Scenario => ({
  steps: [
    { writeFile: "init.mp4", content: "init" },
    { writeFile: "seg-00001.m4s", content: "one" },
    { writeFile: "index.m3u8", content: playlist(1, false) },
    { stdout: "out_time_us=6000000\nprogress=continue\n" },
    { sleepMs: pause },
    ...extra,
    { writeFile: "seg-00002.m4s", content: "two" },
    { writeFile: "index.m3u8", content: playlist(2, true) },
    { stdout: "out_time_us=12000000\nprogress=end\n" },
  ],
});

/** An entry's rendition stored in the harness's store, and a queued copy of it. */
async function copy(
  over: { last_used_at?: Date; started_at?: Date; ready_segments?: number } = {},
) {
  const profile = await seededDefault(t.db);
  const m = await t.db
    .insertInto("media")
    .values({ extractor: "youtube", video_id: randomUUID(), duration: 12 })
    .returning("id")
    .executeTakeFirstOrThrow();
  const key = `media/${m.id}.webm`;
  await (await h.deps({ steps: [] })).store.put(key, src, "video/webm");
  const r = await t.db
    .insertInto("renditions")
    .values({
      media_id: m.id,
      profile_id: profile.id,
      profile_revision: profile.revision,
      storage_key: key,
      size_bytes: 5,
      container: "webm",
      duration: 12,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await t.db
    .insertInto("library_entries")
    .values({ user_id: userId, media_id: m.id, rendition_id: r.id })
    .execute();
  const c = await t.db
    .insertInto("transcodes")
    .values({
      source_rendition_id: r.id,
      encoder: "libx264",
      settings: settingsRevision("libx264"),
      ...over,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return c.id;
}

const row = (id: string) =>
  t.db.selectFrom("transcodes").selectAll().where("id", "=", id).executeTakeFirst();
const trash = async () =>
  (await t.db.selectFrom("storage_trash").select("key").execute()).map((r) => r.key);
const run = (deps: WorkerDeps, id: string, signal?: AbortSignal) =>
  transcodeProcessor(deps, signal)({ data: { transcodeId: id } });

/** A store that records every key put, with the playlist's text at that moment. */
function recording(store: MediaStore) {
  const puts: { key: string; text: string | null }[] = [];
  const wrapped: MediaStore = {
    ...store,
    async put(key, file, type) {
      puts.push({ key, text: key.endsWith(".m3u8") ? await readFile(file, "utf8") : null });
      return store.put(key, file, type);
    },
  };
  return { puts, wrapped };
}

describe("transcode consumer", () => {
  it("encodes a VP9 file and uploads its segments as they finish", async () => {
    const id = await copy();
    const deps = await h.transcodeDeps(twoSegments(), vp9);
    await run(deps, id);
    expect(await row(id)).toMatchObject({
      state: "done",
      mode: "encode",
      attempt: 1,
      ready_segments: 2,
      progress: 1,
      codecs: "avc1.640028,mp4a.40.2",
      resolution: "1920x1080",
      error_message: null,
    });
    const stored = await deps.store.open(`.transcodes/${id}/1/index.m3u8`);
    const text = await new Response(stored.body).text();
    expect(text).toContain("seg-00002.m4s");
    expect(text.trim().endsWith("#EXT-X-ENDLIST")).toBe(true);
    expect(await deps.store.stat(`.transcodes/${id}/1/init.mp4`)).not.toBeNull();
  });

  it("uploads segments before the playlist that names them", async () => {
    const id = await copy();
    const base = await h.transcodeDeps(twoSegments(2500), vp9);
    const { puts, wrapped } = recording(base.store);
    await run({ ...base, store: wrapped }, id);
    const playlists = puts.filter((p) => p.text !== null);
    expect(playlists.length).toBeGreaterThanOrEqual(2);
    for (const p of playlists) {
      const named = (p.text ?? "").split("\n").filter((l) => l.startsWith("seg-"));
      const before = puts.slice(0, puts.indexOf(p)).map((q) => q.key.split("/").at(-1));
      for (const seg of named) expect(before).toContain(seg);
      expect(before).toContain("init.mp4");
    }
  }, 15_000);

  it("remuxes 8-bit H.264", async () => {
    const id = await copy();
    await run(await h.transcodeDeps(twoSegments(), h264), id);
    expect(await row(id)).toMatchObject({ state: "done", mode: "remux", resolution: "1280x720" });
    expect((await h.runs.at(-2)?.argv())?.join(" ")).toContain("-c:v copy -c:a copy");
  });

  it("makes an AAC copy of an audio-only file", async () => {
    const id = await copy();
    await run(await h.transcodeDeps(twoSegments(), opus), id);
    expect(await row(id)).toMatchObject({
      state: "done",
      mode: "audio",
      codecs: "mp4a.40.2",
      resolution: null,
    });
  });

  it("tone-maps an HDR source", async () => {
    const id = await copy();
    await run(await h.transcodeDeps(twoSegments(), hdr), id);
    expect((await h.runs.at(-2)?.argv())?.join(" ")).toContain("tonemap=hable");
  });

  it("drops an abandoned copy without running ffmpeg", async () => {
    const id = await copy({ last_used_at: new Date(Date.now() - 11 * 60_000) });
    await run(await h.transcodeDeps({ steps: [], exitCode: 1 }, vp9), id);
    expect(await row(id)).toBeUndefined();
  });

  it("a rerun writes the next attempt and trashes the last", async () => {
    const id = await copy({ started_at: new Date(Date.now() - 60_000) });
    await run(await h.transcodeDeps(twoSegments(), vp9), id);
    expect(await row(id)).toMatchObject({ state: "done", attempt: 2 });
    expect(await trash()).toContain(`.transcodes/${id}/1/`);
  });

  it("stops when its copy is deleted mid-run", async () => {
    const id = await copy();
    const deps = await h.transcodeDeps(twoSegments(8000), vp9);
    const started = Date.now();
    const running = run(deps, id);
    await sleep(500);
    await t.db.deleteFrom("transcodes").where("id", "=", id).execute();
    await running;
    expect(Date.now() - started).toBeLessThan(6000);
    expect(await trash()).toContain(`.transcodes/${id}/`);
  }, 15_000);

  it("records a failure with ffmpeg's message", async () => {
    const id = await copy();
    await run(
      await h.transcodeDeps(
        { steps: [{ stderr: "Error while decoding stream #0:0\n" }], exitCode: 1 },
        vp9,
      ),
      id,
    );
    expect(await row(id)).toMatchObject({
      state: "failed",
      error_message: "Error while decoding stream #0:0",
    });
  });

  it("a copy cut by shutdown goes back unrecorded", async () => {
    const id = await copy();
    const stop = new AbortController();
    const running = run(await h.transcodeDeps(twoSegments(8000), vp9), id, stop.signal);
    await sleep(500);
    stop.abort();
    await expect(running).rejects.toThrow();
    expect(await row(id)).toMatchObject({ state: "queued", error_message: null });
  }, 15_000);
});
