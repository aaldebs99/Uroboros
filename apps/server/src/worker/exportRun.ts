import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Chapter } from "@uroboros/contract";
import {
  audioExportArgs,
  chaptersMetadata,
  exportArgs,
  ffprobe,
  meaningfulLine,
  progressSeconds,
  spawnStream,
  type ExportPlan,
  type MediaStream,
  type Pipeline,
} from "@uroboros/ytdlp";
import { sql } from "kysely";
import { z } from "zod";
import type { ExportJob } from "../downloads/queues.ts";
import { clipOf, readyBody } from "../exports/clip.ts";
import { remapChapters } from "../exports/cuts.ts";
import { exportKey } from "../exports/store.ts";
import { contentTypeOf } from "../storage/contentType.ts";
import { RequeueError, UnrecoverableError } from "../jobs/errors.ts";
import type { Processor } from "../jobs/queues.ts";
import { sendNotice } from "../notices/send.ts";
import { choosePipeline, encoderOf, pipelinesFor, sourceKey } from "../transcode/hwaccel.ts";
import { h264Level, outputSize, rungFor } from "../transcode/ladder.ts";
import { eff } from "../library/edits.ts";
import type { WorkerDeps } from "./deps.ts";
import { audioPlanFor } from "./exportAudio.ts";
import { rangesOf } from "./exportRanges.ts";
import { openScratch, type Scratch } from "./scratch.ts";
import { readInput } from "./sessionSource.ts";

/**
 * The `export` job (docs/transcoding.md "Saving without SponsorBlock segments"): re-encodes an
 * entry's file with its cuts taken out, on this replica's GPU when it has one (decoding on the CPU,
 * so the frames can be trimmed and joined) or the CPU, writes how far it is to the row, stores the
 * copy, and tells its person it is ready to save.
 */

/** A cut for shutdown goes back to the queue this soon, on any replica. */
const SHUTDOWN_REQUEUE_DELAY_MS = 1000;
/** The row hears the encode's progress at most this often. */
const PROGRESS_EVERY_MS = 2000;
/** A copy may run at most this much faster than its source's rung (it is kept, not streamed). */
const BITRATE_HEADROOM = 1.5;

const HDR = new Set(["smpte2084", "arib-std-b67"]);
const Spans = z.array(z.object({ start: z.number(), end: z.number() }));
const Chapters = z.array(Chapter);

class ShutdownCut extends Error {}
/** The copy's row went (its person removed it): stop, record nothing. */
class Gone extends Error {}
/** ffmpeg failed: its reason is the person's. */
class EncodeFailed extends Error {}

const env = (e: Record<string, string> | undefined) => (e === undefined ? {} : { env: e });

export interface ExportProcessor {
  process: Processor<ExportJob>;
  /** Cuts every running copy for shutdown; each goes back to its queue. */
  abortAll(): void;
}

export function exportProcessor(deps: WorkerDeps): ExportProcessor {
  const running = new Set<AbortController>();
  return {
    abortAll() {
      for (const cut of running) cut.abort(new ShutdownCut("the replica is shutting down"));
    },
    async process(job) {
      const cut = new AbortController();
      running.add(cut);
      const { exportId } = job.data;
      let scratch: Scratch | undefined;
      try {
        // A folder of this run's own: a run that lost the job may still be writing in its folder.
        scratch = await openScratch(deps.workDir, `export-${exportId}`);
        await makeCopy(deps, exportId, scratch.dir, AbortSignal.any([job.signal, cut.signal]));
      } catch (err) {
        if (err instanceof Gone) return;
        if (cut.signal.aborted) {
          await backToQueue(deps, exportId);
          throw new RequeueError(SHUTDOWN_REQUEUE_DELAY_MS, { cause: err });
        }
        // A run that lost its job records nothing: the run holding it now does.
        if (job.signal.aborted) throw err;
        const last = err instanceof UnrecoverableError || job.attemptsMade + 1 >= job.opts.attempts;
        if (last) await failCopy(deps, exportId, err);
        else await backToQueue(deps, exportId);
        throw err;
      } finally {
        running.delete(cut);
        await scratch?.dispose();
      }
    },
  };
}

/** What the person reads when their copy failed. */
function reasonOf(err: unknown): string {
  if (err instanceof EncodeFailed || err instanceof UnrecoverableError) return err.message;
  return "the copy could not be made";
}

async function failCopy(deps: WorkerDeps, id: string, err: unknown): Promise<void> {
  const res = await deps.db
    .updateTable("exports")
    .set({ state: "failed", error: reasonOf(err).slice(0, 500), finished_at: new Date() })
    .where("id", "=", id)
    .where("state", "in", ["queued", "running"])
    .executeTakeFirst();
  if (res.numUpdatedRows > 0n) deps.logger.warn({ err, exportId: id }, "a copy failed");
}

async function backToQueue(deps: WorkerDeps, id: string): Promise<void> {
  await deps.db
    .updateTable("exports")
    .set({ state: "queued", progress: null })
    .where("id", "=", id)
    .where("state", "=", "running")
    .execute();
}

/** The copy, titled as the owner of the entry it was cut from shows it (docs/library.md#your-own-details). */
async function loadCopy(deps: WorkerDeps, id: string) {
  return deps.db
    .selectFrom("exports as x")
    .innerJoin("renditions as r", "r.id", "x.rendition_id")
    .innerJoin("media as m", "m.id", "r.media_id")
    .innerJoin("library_entries as e", "e.id", "x.entry_id")
    .leftJoin("media_edits as ed", (j) =>
      j.onRef("ed.media_id", "=", "e.media_id").onRef("ed.user_id", "=", "e.user_id"),
    )
    .select([
      "x.id",
      "x.user_id",
      "x.state",
      "x.cuts",
      "x.format",
      "x.clip_start",
      "x.clip_end",
      "r.storage_key",
      eff.title.as("title"),
      "m.video_id",
      "m.chapters",
    ])
    .where("x.id", "=", id)
    .executeTakeFirst();
}

/** The encode's video settings: the source's own size, its rung's cap with headroom, HDR mapped. */
function videoSettings(video: MediaStream, pipeline: Pipeline): ExportPlan["video"] {
  const width = video.width ?? 1280;
  const height = video.height ?? 720;
  const size = outputSize(width, height, Math.min(width, height));
  const transfer = video.colorTransfer ?? "";
  return {
    index: video.index,
    pipeline,
    ...size,
    bitrate: Math.round(rungFor(Math.min(size.width, size.height)).bitrate * BITRATE_HEADROOM),
    level: h264Level(size.width, size.height).idc,
    hdr: HDR.has(transfer) ? (transfer as "smpte2084" | "arib-std-b67") : null,
  };
}

/** The GPU pipelines that decode on the CPU (trim and concat need software frames), then the CPU. */
function exportChain(deps: WorkerDeps): Pipeline[] {
  const t = deps.transcoder;
  return pipelinesFor(t.hwaccel, t.gpuWorks).filter((p) => p === "cpu" || p.endsWith("-sw"));
}

async function makeCopy(deps: WorkerDeps, id: string, dir: string, signal: AbortSignal) {
  const row = await loadCopy(deps, id);
  if (row === undefined) throw new Gone();
  if (row.state === "done" || row.state === "failed") return;
  const started = await deps.db
    .updateTable("exports")
    .set({ state: "running", progress: 0, error: null })
    .where("id", "=", id)
    .executeTakeFirst();
  if (started.numUpdatedRows === 0n) throw new Gone();
  const t = deps.transcoder;
  const input = await readInput(deps, row.storage_key).catch((err: unknown) => {
    throw new UnrecoverableError("the video's file can't be read", { cause: err });
  });
  const info = await ffprobe(input, { binary: t.ffprobe.binary, ...env(t.ffprobe.env), signal });
  // A music file's cover art (an attached picture) is no video: such a file is copied as audio.
  const video = info.streams.find((s) => s.type === "video" && !s.attachedPic);
  const audio = info.streams.find((s) => s.type === "audio") ?? null;
  const { ranges, seek, kept, chapterCuts } = rangesOf(
    { cuts: Spans.parse(row.cuts), clip: clipOf(row) },
    info,
    video !== undefined,
  );
  await mkdir(dir, { recursive: true });
  const chapters = remapChapters(
    Chapters.safeParse(row.chapters).data ?? [],
    chapterCuts,
    info.duration,
  );
  const chaptersFile = chapters.length === 0 ? null : join(dir, "chapters.txt");
  if (chaptersFile !== null) await writeFile(chaptersFile, chaptersMetadata(chapters));
  const output = join(dir, `copy.${row.format}`);
  if (video === undefined) {
    const audioPlan = audioPlanFor(info, {
      input,
      output,
      ranges,
      chapters: chaptersFile,
      format: row.format,
    });
    const encoder = audioPlan.encoder[1] ?? "audio";
    const outcome = await encode(
      deps,
      id,
      { args: audioExportArgs(audioPlan), encoder },
      kept,
      signal,
    );
    if (!outcome.ok) throw new EncodeFailed(outcome.reason);
    await storeCopy(deps, row, output, encoder);
    return;
  }
  const plan = (pipeline: Pipeline): ExportPlan => ({
    input,
    output,
    ranges,
    seek,
    video: videoSettings(video, pipeline),
    audio: audio === null ? null : { index: audio.index },
    vaapiDevice: t.vaapiDevice,
    chapters: chaptersFile,
    title: row.title ?? row.video_id,
  });
  const encoder = await encodeOnChain(deps, id, video, plan, kept, signal);
  await storeCopy(deps, row, output, encoder);
}

/** Tries the chain's pipelines in turn; one that fails before any output moves to the next. */
async function encodeOnChain(
  deps: WorkerDeps,
  id: string,
  video: MediaStream,
  plan: (pipeline: Pipeline) => ExportPlan,
  kept: number | null,
  signal: AbortSignal,
): Promise<string> {
  const memo = deps.transcoder.memo;
  const key = sourceKey(video);
  const chain = exportChain(deps);
  for (let pipeline = choosePipeline(chain, memo, key); ;) {
    const run = { args: exportArgs(plan(pipeline)), encoder: encoderOf(pipeline) };
    const outcome = await encode(deps, id, run, kept, signal);
    if (outcome.ok) return encoderOf(pipeline);
    if (outcome.progressed || pipeline === "cpu") throw new EncodeFailed(outcome.reason);
    deps.logger.warn(
      { exportId: id, pipeline, reason: outcome.reason },
      "a copy's pipeline failed",
    );
    memo.markFailed(pipeline, key);
    pipeline = choosePipeline(chain, memo, key);
  }
}

type Outcome = { ok: true } | { ok: false; progressed: boolean; reason: string };

/** One ffmpeg run (`args`, encoding with `encoder`), its progress written to the row; a row gone stops it. */
async function encode(
  deps: WorkerDeps,
  id: string,
  run: { args: string[]; encoder: string },
  kept: number | null,
  signal: AbortSignal,
): Promise<Outcome> {
  const t = deps.transcoder;
  await deps.db.updateTable("exports").set({ encoder: run.encoder }).where("id", "=", id).execute();
  const proc = spawnStream({
    binary: t.ffmpeg.binary,
    args: run.args,
    ...env(t.ffmpeg.env),
    signal,
  });
  let progressed = false;
  let gone = false;
  let wrote = 0;
  let pending = "";
  for await (const chunk of proc.stdout) {
    pending += chunk.toString("utf8");
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    const reached = lines
      .map(progressSeconds)
      .filter((s) => s !== null)
      .at(-1);
    if (reached === undefined) continue;
    progressed ||= reached > 0;
    if (Date.now() - wrote < PROGRESS_EVERY_MS) continue;
    wrote = Date.now();
    const progress = kept === null || kept <= 0 ? null : Math.min(0.99, reached / kept);
    const res = await deps.db
      .updateTable("exports")
      .set({ progress })
      .where("id", "=", id)
      .where("state", "=", "running")
      .executeTakeFirst();
    if (res.numUpdatedRows === 0n) {
      gone = true;
      proc.stop();
      break;
    }
  }
  const exit = await proc.exited;
  if (gone) throw new Gone();
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
  if (exit.code === 0 && !exit.stopped) return { ok: true };
  return { ok: false, progressed, reason: meaningfulLine(exit.stderrTail) || "ffmpeg failed" };
}

/** Stores the copy, marks it done and tells its person; a row gone meanwhile takes the file back. */
async function storeCopy(
  deps: WorkerDeps,
  row: {
    id: string;
    user_id: string;
    title: string | null;
    video_id: string;
    format: string;
    clip_start: number | null;
    clip_end: number | null;
  },
  output: string,
  encoder: string,
): Promise<void> {
  const key = exportKey(row.id, row.format);
  // Scratch on the library's disk makes this a rename (docs/downloads.md "Scratch space").
  const { size } = await deps.store.move(key, output, contentTypeOf(row.format));
  const done = await deps.db
    .updateTable("exports")
    .set({
      state: "done",
      progress: 1,
      encoder,
      storage_key: key,
      size_bytes: size,
      finished_at: sql<Date>`now()`,
    })
    .where("id", "=", row.id)
    .where("state", "=", "running")
    .executeTakeFirst();
  if (done.numUpdatedRows === 0n) {
    await deps.store.delete(key);
    throw new Gone();
  }
  await sendNotice(
    { db: deps.db, notify: deps.queues.notify },
    {
      userId: row.user_id,
      kind: "downloads",
      message: {
        title: "Ready to save",
        body: readyBody(row.title ?? row.video_id, clipOf(row)),
        path: "/downloads",
        tag: `export-${row.id}`,
      },
      urgency: "normal",
    },
  );
}
