import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, type FakeRun, type Scenario } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordingLogger } from "../../test/apiConfig.ts";
import { signedIn } from "../../test/auth.ts";
import { testBus } from "../../test/bus.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { PreviewJob } from "../downloads/queues.ts";
import { RequeueError } from "../jobs/errors.ts";
import { previewKey } from "../previews/queue.ts";
import { PipelineMemo } from "../transcode/hwaccel.ts";
import type { WorkerDeps } from "./deps.ts";
import { previewProcessor } from "./previewRun.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db, 1);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

/** A media with a stored video (an H.264 rendition of the probe fixture). */
async function storedVideo(): Promise<string> {
  const me = await signedIn(t.db, { username: `pv${String(++n)}` });
  const e = await seedEntry(t.db, me.userId);
  await t.db
    .updateTable("renditions")
    .set({ video_codec: "h264", width: 320, height: 240 })
    .where("id", "=", e.renditionId)
    .execute();
  return e.mediaId;
}

const job = (mediaId: string, attempts = 2, attemptsMade = 1) => ({
  id: `j-${mediaId}`,
  queue: "preview" as const,
  name: "preview",
  key: `preview:${mediaId}`,
  data: { mediaId } satisfies PreviewJob,
  attemptsMade,
  opts: { attempts },
  signal: new AbortController().signal,
});

/** Where the fake ffmpeg writes: its last argument, the preview in the run's scratch folder. */
const OUTPUT = "{{lastArg}}";

/**
 * Deps whose transcoder runs `ffmpeg`, its ffprobe describing the fixture clip (silent: no audio),
 * on the CPU unless `transcoder` gives the replica a GPU.
 */
async function depsFor(
  ffmpeg: Scenario,
  {
    silent = false,
    transcoder = {},
  }: { silent?: boolean; transcoder?: Partial<WorkerDeps["transcoder"]> } = {},
) {
  const probe = JSON.parse(await fixture("ffprobe-clip.json")) as {
    streams: { codec_type: string }[];
  };
  if (silent) probe.streams = probe.streams.filter((s) => s.codec_type !== "audio");
  const deps = await h.sessionDeps(ffmpeg, probe, transcoder);
  const ffmpegRun = h.runs.at(-2) as FakeRun;
  return { deps, ffmpegRun };
}

const mediaOf = (id: string) =>
  t.db
    .selectFrom("media")
    .select(["preview_key", "preview_failed_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

const previewBytes = async (id: string) =>
  (
    await t.db
      .selectFrom("media")
      .select("preview_bytes")
      .where("id", "=", id)
      .executeTakeFirstOrThrow()
  ).preview_bytes;

describe("making a hover preview", () => {
  it("encodes the whole video with its sound on the CPU and stores it beside the media", async () => {
    const id = await storedVideo();
    const { deps, ffmpegRun } = await depsFor({
      steps: [{ writeFile: OUTPUT, content: "clip" }],
    });
    await previewProcessor(deps).process(job(id));
    expect(await mediaOf(id)).toEqual({ preview_key: previewKey(id), preview_failed_at: null });
    expect(await readFile(join(h.root, previewKey(id)), "utf8")).toBe("clip");
    expect(await previewBytes(id)).toBe(String("clip".length));
    const args = await ffmpegRun.argv();
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(args).not.toContain("-ss");
    expect(args.flatMap((a, i) => (a === "-map" ? [args[i + 1]] : []))).toEqual(["0:0", "0:1"]);
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
    // The fixture is 320x240, under 480p, so it keeps its size.
    expect(args[args.indexOf("-vf") + 1]).toContain("scale=320:240");
  });

  it("never clears a folder another run of the preview still writes in", async () => {
    const id = await storedVideo();
    const theirs = join(h.workDir, `preview-${id}`);
    await mkdir(theirs, { recursive: true });
    await writeFile(join(theirs, "preview.mp4"), "theirs");
    const { deps } = await depsFor({ steps: [{ writeFile: OUTPUT, content: "clip" }] });
    await previewProcessor(deps).process(job(id));
    expect(await readFile(join(theirs, "preview.mp4"), "utf8")).toBe("theirs");
    await rm(theirs, { recursive: true });
  });

  it("makes a silent preview of a file without sound", async () => {
    const id = await storedVideo();
    const { deps, ffmpegRun } = await depsFor(
      { steps: [{ writeFile: OUTPUT, content: "clip" }] },
      { silent: true },
    );
    await previewProcessor(deps).process(job(id));
    const args = await ffmpegRun.argv();
    expect(args.filter((a) => a === "-map")).toHaveLength(1);
    expect(args).toContain("-an");
  });

  it("runs nothing for a media that already has its preview", async () => {
    const id = await storedVideo();
    await t.db
      .updateTable("media")
      .set({ preview_key: previewKey(id) })
      .where("id", "=", id)
      .execute();
    const { deps, ffmpegRun } = await depsFor({ steps: [], exitCode: 1 });
    await previewProcessor(deps).process(job(id));
    // The fake writes its arguments when started: none were.
    await expect(ffmpegRun.argv()).rejects.toThrow();
  });

  it("marks the media on its last attempt, so the backfill leaves it be", async () => {
    const id = await storedVideo();
    const { deps } = await depsFor({ steps: [{ stderr: "Invalid data\n" }], exitCode: 1 });
    await expect(previewProcessor(deps).process(job(id))).rejects.toThrow("Invalid data");
    const row = await mediaOf(id);
    expect(row.preview_key).toBeNull();
    expect(row.preview_failed_at).not.toBeNull();
  });

  it("leaves the media unmarked while an attempt is left", async () => {
    const id = await storedVideo();
    const { deps } = await depsFor({ steps: [{ stderr: "boom\n" }], exitCode: 1 });
    await expect(previewProcessor(deps).process(job(id, 2, 0))).rejects.toThrow();
    expect((await mediaOf(id)).preview_failed_at).toBeNull();
  });

  it("gives up at once on a media with no stored video", async () => {
    const me = await signedIn(t.db, { username: `pv${String(++n)}` });
    const audio = await seedEntry(t.db, me.userId);
    const { deps } = await depsFor({ steps: [] });
    await expect(previewProcessor(deps).process(job(audio.mediaId, 2, 0))).rejects.toThrow(
      "no stored video",
    );
    expect((await mediaOf(audio.mediaId)).preview_failed_at).not.toBeNull();
  });

  it("tells the video's people when it starts and when it ends, made or failed", async () => {
    const owner = (id: string) =>
      t.db
        .selectFrom("library_entries")
        .select("user_id")
        .where("media_id", "=", id)
        .executeTakeFirstOrThrow();
    const bus = testBus(t);
    await bus.ready;
    const heard: string[] = [];
    bus.on("uroboros_downloads", (payload) => {
      const e = JSON.parse(payload) as { kind: string; userIds?: string[] };
      if (e.kind === "previews") heard.push(...(e.userIds ?? []));
    });
    const made = await storedVideo();
    const userId = (await owner(made)).user_id;
    const ok = await depsFor({ steps: [{ writeFile: OUTPUT, content: "clip" }] });
    await previewProcessor(ok.deps).process(job(made));
    await expect.poll(() => heard.filter((u) => u === userId).length).toBe(2);
    const failed = await storedVideo();
    const other = await owner(failed);
    const bad = await depsFor({ steps: [{ stderr: "boom\n" }], exitCode: 1 });
    await expect(previewProcessor(bad.deps).process(job(failed))).rejects.toThrow();
    await expect.poll(() => heard.filter((u) => u === other.user_id).length).toBe(2);
    await bus.close();
  });

  it("takes the clip back when the media went while it was cut", async () => {
    const id = await storedVideo();
    const { deps, ffmpegRun } = await depsFor({
      steps: [{ sleepMs: 1500 }, { writeFile: OUTPUT, content: "clip" }],
    });
    const run = previewProcessor(deps).process(job(id));
    await expect
      .poll(
        () =>
          ffmpegRun.argv().then(
            () => true,
            () => false,
          ),
        { timeout: 5000 },
      )
      .toBe(true);
    await t.db.deleteFrom("library_entries").where("media_id", "=", id).execute();
    await t.db.deleteFrom("renditions").where("media_id", "=", id).execute();
    await t.db.deleteFrom("media").where("id", "=", id).execute();
    await run;
    await expect(readFile(join(h.root, previewKey(id)))).rejects.toThrow();
  });
});

describe("making a hover preview on the replica's GPU", () => {
  /** The fixture clip's kind of source, as the sessions' memo keys it. */
  const SOURCE = "h264/yuv444p";
  const stored = { steps: [{ writeFile: OUTPUT, content: "clip" }] };
  const nvenc = (memo = new PipelineMemo()) => ({
    hwaccel: "nvenc" as const,
    gpuWorks: true,
    memo,
  });
  const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

  it("decodes, scales and encodes there when the replica has one", async () => {
    const id = await storedVideo();
    const { deps, ffmpegRun } = await depsFor(stored, { transcoder: nvenc() });
    await previewProcessor(deps).process(job(id));
    expect(await mediaOf(id)).toEqual({ preview_key: previewKey(id), preview_failed_at: null });
    const args = await ffmpegRun.argv();
    expect(after(args, "-hwaccel")).toBe("cuda");
    expect(after(args, "-vf")).toContain("scale_cuda=");
    expect(after(args, "-c:v")).toBe("h264_nvenc");
  });

  it("uses the replica's VA-API render node", async () => {
    const id = await storedVideo();
    const { deps, ffmpegRun } = await depsFor(stored, {
      transcoder: { hwaccel: "vaapi", gpuWorks: true, vaapiDevice: "/dev/dri/renderD129" },
    });
    await previewProcessor(deps).process(job(id));
    const args = await ffmpegRun.argv();
    expect(after(args, "-init_hw_device")).toBe("vaapi=va:/dev/dri/renderD129");
    expect(after(args, "-c:v")).toBe("h264_vaapi");
  });

  it("keeps to the CPU when the GPU failed the replica's self-test", async () => {
    const id = await storedVideo();
    const { deps, ffmpegRun } = await depsFor(stored, {
      transcoder: { hwaccel: "nvenc", gpuWorks: false },
    });
    await previewProcessor(deps).process(job(id));
    const args = await ffmpegRun.argv();
    expect(args).not.toContain("-hwaccel");
    expect(after(args, "-c:v")).toBe("libx264");
  });

  it("moves on through the GPU's pipelines to the CPU for this preview, leaving the sessions' memo alone", async () => {
    const id = await storedVideo();
    const memo = new PipelineMemo();
    const { deps, ffmpegRun } = await depsFor(
      {
        ...stored,
        variants: [
          { whenArg: "h264_nvenc", steps: [{ stderr: "Cannot load libcuda.so.1\n" }], exitCode: 1 },
        ],
      },
      { transcoder: nvenc(memo) },
    );
    const { logger, lines } = recordingLogger();
    await previewProcessor({ ...deps, logger }).process(job(id));
    expect(await mediaOf(id)).toEqual({ preview_key: previewKey(id), preview_failed_at: null });
    expect(after(await ffmpegRun.argv(), "-c:v")).toBe("libx264");
    expect(lines.filter((l) => l.level === 40).map((l) => [l.pipeline, l.mediaId])).toEqual([
      ["nvenc", id],
      ["nvenc-sw", id],
    ]);
    // A passing failure (playback holding every encoder session, say) never costs playback the GPU.
    expect(memo.failed("nvenc", SOURCE)).toBe(false);
    expect(memo.failed("nvenc-sw", SOURCE)).toBe(false);
  });

  it("fails the attempt at once when a GPU run encoded part of the video, never encoding it all again", async () => {
    const id = await storedVideo();
    const { deps, ffmpegRun } = await depsFor(
      {
        ...stored,
        variants: [
          {
            whenArg: "h264_nvenc",
            steps: [
              { stdout: "out_time_us=90000000\nprogress=continue\n" },
              { stderr: "Error while decoding stream #0:0: Invalid data found\n" },
            ],
            exitCode: 1,
          },
        ],
      },
      { transcoder: nvenc() },
    );
    const { logger, lines } = recordingLogger();
    await expect(previewProcessor({ ...deps, logger }).process(job(id, 2, 0))).rejects.toThrow(
      "Invalid data found",
    );
    expect(after(await ffmpegRun.argv(), "-c:v")).toBe("h264_nvenc");
    expect(lines.filter((l) => l.msg === "a hover preview's GPU run failed")).toEqual([]);
    expect(await mediaOf(id)).toEqual({ preview_key: null, preview_failed_at: null });
  });

  it("starts past a pipeline the sessions found broken on this kind of source", async () => {
    const id = await storedVideo();
    const memo = new PipelineMemo();
    memo.markFailed("nvenc", SOURCE);
    const { deps, ffmpegRun } = await depsFor(stored, { transcoder: nvenc(memo) });
    await previewProcessor(deps).process(job(id));
    const args = await ffmpegRun.argv();
    expect(args).not.toContain("-hwaccel");
    expect(after(args, "-vf")).toContain("hwupload_cuda");
    expect(after(args, "-c:v")).toBe("h264_nvenc");
  });

  it("goes back to the queue when cut for shutdown on the GPU, never trying the CPU", async () => {
    const id = await storedVideo();
    const { deps, ffmpegRun } = await depsFor(
      { ...stored, variants: [{ whenArg: "h264_nvenc", steps: [{ hang: true }] }] },
      { transcoder: nvenc() },
    );
    const previews = previewProcessor(deps);
    const run = previews.process(job(id));
    await expect
      .poll(
        () =>
          ffmpegRun.argv().then(
            (a) => after(a, "-c:v"),
            () => null,
          ),
        { timeout: 5000 },
      )
      .toBe("h264_nvenc");
    previews.abortAll();
    await expect(run).rejects.toBeInstanceOf(RequeueError);
    expect(after(await ffmpegRun.argv(), "-c:v")).toBe("h264_nvenc");
    expect(await mediaOf(id)).toEqual({ preview_key: null, preview_failed_at: null });
  });
});
