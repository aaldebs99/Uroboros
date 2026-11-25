import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, type Scenario } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { queuedData } from "../../test/jobs.ts";
import { seedEntry } from "../../test/library.ts";
import { listedNotices } from "../../test/notices.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { ExportJob, NotifyJob } from "../downloads/queues.ts";
import { exportKey } from "../exports/store.ts";
import { PipelineMemo } from "../transcode/hwaccel.ts";
import type { WorkerDeps } from "./deps.ts";
import { exportProcessor } from "./exportRun.ts";

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

/**
 * A copy queued of a fresh 3 s clip (the probe fixture), cutting 1–2 s, with two chapters, made as
 * `format`.
 */
async function queuedCopy(format = "mp4"): Promise<{ id: string; userId: string }> {
  const me = await signedIn(t.db, { username: `xr${String(++n)}` });
  const e = await seedEntry(t.db, me.userId, { title: `Clip ${String(n)}` });
  await t.db
    .updateTable("media")
    .set({
      chapters: JSON.stringify([
        { start: 0, end: 1.5, title: "Start" },
        { start: 1.5, end: 3, title: "End" },
      ]),
    })
    .where("id", "=", e.mediaId)
    .execute();
  const row = await t.db
    .insertInto("exports")
    .values({
      user_id: me.userId,
      entry_id: e.entryId,
      rendition_id: e.renditionId,
      cuts: JSON.stringify([{ start: 1, end: 2 }]),
      format,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { id: row.id, userId: me.userId };
}

const job = (exportId: string, attempts = 1) => ({
  id: `j-${exportId}`,
  queue: "export" as const,
  name: "export",
  key: `export:${exportId}`,
  data: { exportId } satisfies ExportJob,
  attemptsMade: 0,
  opts: { attempts },
  signal: new AbortController().signal,
});

const output = (id: string) => join(h.workDir, `export-${id}`, "copy.mp4");
const progress = (s: number) => ({
  stdout: `out_time_us=${String(s * 1_000_000)}\nprogress=continue\n`,
});

async function depsFor(ffmpeg: Scenario, transcoder: Partial<WorkerDeps["transcoder"]> = {}) {
  const probe = JSON.parse(await fixture("ffprobe-clip.json")) as unknown;
  const deps = await h.sessionDeps(ffmpeg, probe, transcoder);
  const ffmpegRun = h.runs.at(-2);
  if (ffmpegRun === undefined) throw new Error("no ffmpeg fake");
  return { deps, ffmpegRun };
}

const rowOf = (id: string) =>
  t.db.selectFrom("exports").selectAll().where("id", "=", id).executeTakeFirst();

describe("making a copy without sponsors", () => {
  it("trims, joins and encodes on the CPU, stores the copy, and tells its person", async () => {
    const copy = await queuedCopy();
    const { deps, ffmpegRun } = await depsFor({
      steps: [progress(1), { writeFile: output(copy.id), content: "mp4 bytes" }, progress(2)],
    });
    await exportProcessor(deps).process(job(copy.id));
    expect(await rowOf(copy.id)).toMatchObject({
      state: "done",
      progress: 1,
      encoder: "libx264",
      storage_key: exportKey(copy.id, "mp4"),
      size_bytes: "9",
      error: null,
    });
    expect(await readFile(join(h.root, exportKey(copy.id, "mp4")), "utf8")).toBe("mp4 bytes");
    const args = await ffmpegRun.argv();
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[0:0]trim=start=0.000:end=1.000");
    expect(graph).toContain("[0:1]atrim=start=2.000,asetpts=PTS-STARTPTS[a1]");
    expect(args[args.indexOf("-map_chapters") + 1]).toBe("1");
    const notices = await queuedData<NotifyJob>(t.db, "notify");
    expect(notices.find((j) => j.userId === copy.userId)?.message).toMatchObject({
      title: "Ready to save",
      path: "/downloads",
    });
    expect(await listedNotices(t.db, copy.userId)).toMatchObject([
      { kind: "downloads", title: "Ready to save", tag: `export-${copy.id}` },
    ]);
  });

  it("moves on to the CPU when the GPU fails before any output, and remembers it", async () => {
    const copy = await queuedCopy();
    const memo = new PipelineMemo();
    const { deps } = await depsFor(
      {
        steps: [{ writeFile: output(copy.id), content: "cpu" }],
        variants: [
          { whenArg: "h264_nvenc", steps: [{ stderr: "Cannot load libcuda.so.1\n" }], exitCode: 1 },
        ],
      },
      { hwaccel: "nvenc", gpuWorks: true, memo },
    );
    await exportProcessor(deps).process(job(copy.id));
    expect(await rowOf(copy.id)).toMatchObject({ state: "done", encoder: "libx264" });
    expect(memo.failed("nvenc-sw", "h264/yuv444p")).toBe(true);
  });

  it("fails with ffmpeg's reason on its last attempt", async () => {
    const copy = await queuedCopy();
    const { deps } = await depsFor({
      steps: [progress(0.5), { stderr: "Error while decoding stream #0:0: Invalid data\n" }],
      exitCode: 1,
    });
    await expect(exportProcessor(deps).process(job(copy.id))).rejects.toThrow();
    const row = await rowOf(copy.id);
    expect(row).toMatchObject({ state: "failed", storage_key: null });
    expect(row?.error).toContain("Invalid data");
    expect(row?.finished_at).not.toBeNull();
  });

  it("goes back to the queue for another attempt when one is left", async () => {
    const copy = await queuedCopy();
    const { deps } = await depsFor({ steps: [{ stderr: "boom\n" }], exitCode: 1 });
    await expect(exportProcessor(deps).process(job(copy.id, 2))).rejects.toThrow();
    expect(await rowOf(copy.id)).toMatchObject({ state: "queued", progress: null });
  });

  it("stops, storing nothing, when its person removes the copy while it runs", async () => {
    const copy = await queuedCopy();
    const { deps } = await depsFor({
      steps: [{ sleepMs: 1500 }, progress(1), { sleepMs: 10_000 }],
    });
    const run = exportProcessor(deps).process(job(copy.id));
    await expect.poll(async () => (await rowOf(copy.id))?.state, { timeout: 5000 }).toBe("running");
    await t.db.deleteFrom("exports").where("id", "=", copy.id).execute();
    await run;
    expect(await rowOf(copy.id)).toBeUndefined();
  });
});

describe("making a copy of an audio file", () => {
  /** ffprobe's view of a 3 s audio file of `codec`, with a cover picture as stream 1. */
  const audioProbe = (codec: string, container: string) => ({
    streams: [
      { index: 0, codec_type: "audio", codec_name: codec, sample_rate: "44100", channels: 2 },
      { index: 1, codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
    ],
    format: { format_name: container, start_time: "0.000000", duration: "3.000000" },
  });

  it("makes an MP3 copy of an MP3 with libmp3lame, keeping the cover", async () => {
    const copy = await queuedCopy("mp3");
    const out = join(h.workDir, `export-${copy.id}`, "copy.mp3");
    const deps = await h.sessionDeps(
      { steps: [progress(1), { writeFile: out, content: "mp3 bytes" }] },
      audioProbe("mp3", "mp3"),
    );
    const ffmpegRun = h.runs.at(-2);
    await exportProcessor(deps).process(job(copy.id));
    expect(await rowOf(copy.id)).toMatchObject({
      state: "done",
      encoder: "libmp3lame",
      storage_key: exportKey(copy.id, "mp3"),
      error: null,
    });
    expect(await readFile(join(h.root, exportKey(copy.id, "mp3")), "utf8")).toBe("mp3 bytes");
    const args = (await ffmpegRun?.argv()) ?? [];
    expect(args.join(" ")).toContain("-c:a libmp3lame -q:a 0");
    expect(args.join(" ")).toContain("-map 0:1 -c:v copy -disposition:v attached_pic");
    expect(args[args.indexOf("-filter_complex") + 1]).toContain(
      "[0:0]atrim=start=2.000,asetpts=PTS-STARTPTS[a1]",
    );
    expect(args.at(-1)).toBe(out);
  });

  it("fails a codec it can't encode again, saying which", async () => {
    const copy = await queuedCopy("wma");
    const deps = await h.sessionDeps({ steps: [] }, audioProbe("wmav2", "asf"));
    await expect(exportProcessor(deps).process(job(copy.id))).rejects.toThrow();
    expect(await rowOf(copy.id)).toMatchObject({
      state: "failed",
      error: "can't cut a wmav2 file",
    });
  });
});
