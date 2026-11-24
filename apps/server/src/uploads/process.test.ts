import { FakeRun, fixture } from "@uroboros/ytdlp/testing";
import { VideoInfo } from "@uroboros/ytdlp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertUser } from "../../test/users.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { RequeueError, UnrecoverableError } from "../jobs/errors.ts";
import type { Job } from "../jobs/queues.ts";
import type { UploadJob } from "../downloads/queues.ts";
import { upsertMedia } from "../worker/media.ts";
import type { WorkerDeps } from "../worker/deps.ts";
import { uploadProcessor } from "./process.ts";
import {
  completeUpload,
  createUpload,
  FAILED_NO_VIDEO,
  FAILED_OTHERWISE,
  failUpload,
  putUploadPart,
  putUploadThumbnail,
} from "./store.ts";

const PART = 4;
const JPEG = Buffer.from("ffd8ffe000104a464946", "hex");
const AUDIO_ONLY = {
  format: { format_name: "mp3", duration: "3.0" },
  streams: [{ index: 0, codec_type: "audio", codec_name: "mp3" }],
};

let t: TestDb;
let wh: Awaited<ReturnType<typeof workerHarness>>;
let deps: WorkerDeps;
const fakes: FakeRun[] = [];

beforeAll(async () => {
  t = await TestDb.create();
  wh = await workerHarness(t.db);
  deps = {
    ...(await wh.deps({ steps: [] })),
    ffmpeg: await fake({ steps: [{ stdoutBase64: JPEG.toString("base64") }] }),
  };
});
afterAll(async () => {
  await Promise.all(fakes.map((f) => f.close()));
  await wh.close();
  await t.close();
});

async function fake(scenario: Parameters<typeof FakeRun.create>[0]) {
  const run = await FakeRun.create(scenario);
  fakes.push(run);
  return { binary: run.options.binary, env: run.options.env };
}

/** An upload of "abcdefghij" with every part in, processing. */
async function received(username: string, thumbnail = false): Promise<string> {
  const userId = await insertUser(t.db, { username });
  const ctx = { ...deps, partBytes: PART };
  const up = await createUpload(ctx, userId, {
    filename: "trip.mp4",
    size: 10,
    title: "Trip",
    description: "Day one",
    creator: "Grandpa",
    tags: ["family", "sea"],
  });
  for (const [n, s] of [
    [1, "abcd"],
    [2, "efgh"],
    [3, "ij"],
  ] as const) {
    await putUploadPart(ctx, userId, up.id, n, Buffer.from(s));
  }
  if (thumbnail) await putUploadThumbnail(ctx, userId, up.id, JPEG);
  await completeUpload(ctx, userId, up.id);
  return up.id;
}

function job(
  uploadId: string,
  attemptsMade = 0,
  signal = new AbortController().signal,
): Job<UploadJob> {
  return {
    id: "1",
    queue: "upload",
    name: "upload",
    key: `upload|${uploadId}`,
    data: { uploadId },
    attemptsMade,
    opts: { attempts: 3 },
    signal,
  };
}

const uploadRow = (id: string) =>
  t.db.selectFrom("uploads").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

describe("the upload job", () => {
  it("files the upload as its own video in its person's library, a frame for its thumbnail", async () => {
    const id = await received("uppjob1");
    await uploadProcessor(deps).process(job(id));
    const up = await uploadRow(id);
    expect(up).toMatchObject({ state: "done", error: null });
    const entry = await t.db
      .selectFrom("library_entries as e")
      .innerJoin("media as m", "m.id", "e.media_id")
      .innerJoin("renditions as r", "r.id", "e.rendition_id")
      .select([
        "e.user_id",
        "m.id as media_id",
        "m.extractor",
        "m.video_id",
        "m.title",
        "m.description",
        "m.channel",
        "m.uploader",
        "m.uploaded_by",
        "m.thumbnail_key",
        "r.profile_id",
        "r.profile_revision",
        "r.storage_key",
        "r.size_bytes",
        "r.container",
        "r.video_codec",
        "r.audio_codec",
      ])
      .where("e.id", "=", up.entry_id ?? "")
      .executeTakeFirstOrThrow();
    expect(entry).toMatchObject({
      user_id: up.user_id,
      media_id: up.media_id,
      extractor: "upload",
      video_id: id,
      title: "Trip",
      description: "Day one",
      channel: "Grandpa",
      uploader: "Grandpa",
      uploaded_by: up.user_id,
      profile_id: null,
      profile_revision: "upload",
      storage_key: up.storage_key,
      size_bytes: "10",
      container: "mp4",
      video_codec: "h264",
      audio_codec: "aac",
    });
    const tags = await t.db
      .selectFrom("entry_tags")
      .select("tag")
      .where("entry_id", "=", up.entry_id ?? "")
      .orderBy("tag")
      .execute();
    expect(tags.map((r) => r.tag)).toEqual(["family", "sea"]);
    expect(await deps.store.stat(up.storage_key)).toEqual({ size: 10 });
    expect(entry.thumbnail_key).toMatch(/\.jpg$/);
    expect(await deps.store.stat(entry.thumbnail_key ?? "")).toEqual({ size: JPEG.length });
    const parts = await t.db
      .selectFrom("upload_parts")
      .select("n")
      .where("upload_id", "=", id)
      .execute();
    expect(parts).toEqual([]);
  });

  it("keeps the thumbnail its person sent", async () => {
    const id = await received("uppjob2", true);
    const sent = (await uploadRow(id)).thumbnail_key;
    await uploadProcessor(deps).process(job(id));
    const media = await t.db
      .selectFrom("media")
      .select("thumbnail_key")
      .where("id", "=", (await uploadRow(id)).media_id)
      .executeTakeFirstOrThrow();
    expect(media.thumbnail_key).toBe(sent);
  });

  it("files a video whose frame can't be grabbed without a thumbnail", async () => {
    const id = await received("uppjob3");
    const broken = { ...deps, ffmpeg: await fake({ steps: [], exitCode: 1 }) };
    await uploadProcessor(broken).process(job(id));
    const up = await uploadRow(id);
    expect(up.state).toBe("done");
    const media = await t.db
      .selectFrom("media")
      .select("thumbnail_key")
      .where("id", "=", up.media_id)
      .executeTakeFirstOrThrow();
    expect(media.thumbnail_key).toBeNull();
  });

  it("fails a file with no video in it, and drops its bytes", async () => {
    const id = await received("uppjob4");
    const audio = {
      ...deps,
      ffprobe: await fake({ steps: [{ stdout: JSON.stringify(AUDIO_ONLY) }] }),
    };
    await expect(uploadProcessor(audio).process(job(id))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    const up = await uploadRow(id);
    expect(up).toMatchObject({ state: "failed", error: FAILED_NO_VIDEO, entry_id: null });
    expect(await deps.store.stat(up.storage_key)).toBeNull();
    const media = await t.db
      .selectFrom("media")
      .select("id")
      .where("id", "=", up.media_id)
      .execute();
    expect(media).toEqual([]);
  });

  it("refuses a file that is no video container (a playlist named .mp4), pinning the demuxers", async () => {
    const id = await received("uppjob8");
    const playlist = {
      format: { format_name: "hls", duration: "10.0" },
      streams: [{ index: 0, codec_type: "video", codec_name: "h264", width: 64, height: 36 }],
    };
    const run = await FakeRun.create({ steps: [{ stdout: JSON.stringify(playlist) }] });
    fakes.push(run);
    const hls = { ...deps, ffprobe: { binary: run.options.binary, env: run.options.env } };
    await expect(uploadProcessor(hls).process(job(id))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await uploadRow(id)).toMatchObject({ state: "failed", error: FAILED_NO_VIDEO });
    const argv = await run.argv();
    expect(argv[argv.indexOf("-format_whitelist") + 1]).toBe("mov,matroska,avi");
  });

  it("is tried again, and fails the upload only on its last try", async () => {
    const id = await received("uppjob5");
    const broken = { ...deps, ffprobe: await fake({ steps: [], exitCode: 1 }) };
    await expect(uploadProcessor(broken).process(job(id, 0))).rejects.toThrow();
    expect((await uploadRow(id)).state).toBe("processing");
    await expect(uploadProcessor(broken).process(job(id, 2))).rejects.toThrow();
    expect(await uploadRow(id)).toMatchObject({ state: "failed", error: FAILED_OTHERWISE });
  });

  it("never undoes an upload a run already filed", async () => {
    const id = await received("uppjob6");
    await uploadProcessor(deps).process(job(id));
    expect(await failUpload(t.db, deps.store, id, FAILED_OTHERWISE)).toBe(false);
    const up = await uploadRow(id);
    expect(up.state).toBe("done");
    expect(await deps.store.stat(up.storage_key)).toEqual({ size: 10 });
    await uploadProcessor(deps).process(job(id));
    const media = await t.db.selectFrom("media").select("id").where("video_id", "=", id).execute();
    expect(media).toHaveLength(1);
  });

  it("goes back to its queue when the replica shuts down", async () => {
    const id = await received("uppjob7");
    const slow = { ...deps, ffprobe: await fake({ steps: [{ sleepMs: 10_000 }] }) };
    const processor = uploadProcessor(slow);
    const run = processor.process(job(id));
    await new Promise((r) => setTimeout(r, 300));
    processor.abortAll();
    await expect(run).rejects.toBeInstanceOf(RequeueError);
    expect((await uploadRow(id)).state).toBe("processing");
  });
});

describe("site videos", () => {
  it("never take the upload extractor", async () => {
    const info = VideoInfo.parse(JSON.parse(await fixture("info-clip.json")));
    await expect(upsertMedia(t.db, { extractor: "Upload", videoId: "x1" }, info)).rejects.toThrow();
  });
});
