import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import {
  ffprobe,
  meaningfulLine,
  previewArgs,
  previewCopyArgs,
  spawnStream,
  type MediaInfo,
  type MediaStream,
  type Pipeline,
  type PreviewPlan,
} from "@uroboros/ytdlp";
import { sql } from "kysely";
import type { PreviewJob } from "../downloads/queues.ts";
import { RequeueError, UnrecoverableError } from "../jobs/errors.ts";
import type { Processor } from "../jobs/queues.ts";
import { announcePreview, previewKey } from "../previews/queue.ts";
import { choosePipeline, pipelinesFor, sourceKey } from "../transcode/hwaccel.ts";
import { h264Level, outputSize } from "../transcode/ladder.ts";
import type { WorkerDeps } from "./deps.ts";
import { downloadPreviewCopy, previewPage } from "./previewDownload.ts";
import { openScratch, type Scratch } from "./scratch.ts";
import { readInput } from "./sessionSource.ts";

/**
 * The `preview` job (docs/library.md "Hover previews"): makes a media's hover preview, the whole
 * video at 480p with its sound, and stores it beside the thumbnail. It comes from the video's site
 * (`UROBOROS_PREVIEW_METHOD=download`, `previewDownload.ts`), copied as it is when the site's copy
 * already is one; otherwise it is encoded with the transcoder's ffmpeg, from that copy or from the
 * stored file, on the replica's GPU when it has one (`encode`) and the CPU otherwise.
 */

/** The preview's short side, and the most it may run at. */
export const PREVIEW_SHORT_SIDE = 480;
const PREVIEW_BITRATE = 1_000_000;
/** A copy from the site is kept as it is up to this rate, rather than encoded again. */
const COPY_MAX_BITRATE = 2 * PREVIEW_BITRATE;
/** 8-bit 4:2:0, the only H.264 every browser plays. */
const BROWSER_PIX_FMTS = new Set(["yuv420p", "yuvj420p"]);
/** A cut for shutdown goes back to the queue this soon, on any replica. */
const SHUTDOWN_REQUEUE_DELAY_MS = 1000;

const HDR = new Set(["smpte2084", "arib-std-b67"]);

class ShutdownCut extends Error {}

const env = (e: Record<string, string> | undefined) => (e === undefined ? {} : { env: e });

export interface PreviewProcessor {
  process: Processor<PreviewJob>;
  /** Cuts every running preview for shutdown; each goes back to its queue. */
  abortAll(): void;
}

export function previewProcessor(deps: WorkerDeps): PreviewProcessor {
  const running = new Set<AbortController>();
  return {
    abortAll() {
      for (const cut of running) cut.abort(new ShutdownCut("the replica is shutting down"));
    },
    async process(job) {
      // Turned off since it was queued: nothing is downloaded or made.
      if (!deps.generatePreviews) return;
      const cut = new AbortController();
      running.add(cut);
      const { mediaId } = job.data;
      let scratch: Scratch | undefined;
      try {
        // A folder of this run's own: a run that lost the job may still be writing in its folder.
        scratch = await openScratch(deps.workDir, `preview-${mediaId}`);
        await makePreview(deps, mediaId, scratch.dir, AbortSignal.any([job.signal, cut.signal]));
      } catch (err) {
        if (cut.signal.aborted) throw new RequeueError(SHUTDOWN_REQUEUE_DELAY_MS, { cause: err });
        // Waiting out the site's cooldown is no failure, on the last attempt either.
        if (job.signal.aborted || err instanceof RequeueError) throw err;
        const last = err instanceof UnrecoverableError || job.attemptsMade + 1 >= job.opts.attempts;
        if (last) await failPreview(deps, mediaId, err);
        await tell(deps, mediaId);
        throw err;
      } finally {
        running.delete(cut);
        await scratch?.dispose();
      }
      await tell(deps, mediaId);
    },
  };
}

/**
 * Nudges the people with the video, so their bells ask again: best effort, since a lost nudge
 * costs only a late bell (it asks every 15 s while previews wait), never the preview itself.
 */
async function tell(deps: WorkerDeps, mediaId: string): Promise<void> {
  try {
    await announcePreview(deps.db, mediaId);
  } catch (err) {
    deps.logger.warn({ err, mediaId }, "could not tell people about a hover preview");
  }
}

/** Marks the media so the backfill leaves it be. */
async function failPreview(deps: WorkerDeps, mediaId: string, err: unknown): Promise<void> {
  await deps.db
    .updateTable("media")
    .set({ preview_failed_at: sql<Date>`now()` })
    .where("id", "=", mediaId)
    .where("preview_key", "is", null)
    .execute();
  deps.logger.warn({ err, mediaId }, "a hover preview could not be made");
}

/**
 * The media's stored video to read: the smallest at least 480p (cheapest to decode), else the
 * tallest; with its format profile's extra arguments, which say whether it was cut from the video.
 */
async function sourceOf(deps: WorkerDeps, mediaId: string) {
  return deps.db
    .selectFrom("renditions as r")
    .leftJoin("format_profiles as p", "p.id", "r.profile_id")
    .select(["r.storage_key", "r.height", "p.extra_args"])
    .where("r.media_id", "=", mediaId)
    .where("r.video_codec", "is not", null)
    .where("r.orphaned_at", "is", null)
    .orderBy(sql`coalesce(r.height, 0) >= ${PREVIEW_SHORT_SIDE}`, "desc")
    .orderBy(
      sql`CASE WHEN coalesce(r.height, 0) >= ${PREVIEW_SHORT_SIDE} THEN r.height ELSE -coalesce(r.height, 0) END`,
    )
    .executeTakeFirst();
}

async function makePreview(deps: WorkerDeps, mediaId: string, dir: string, signal: AbortSignal) {
  const media = await deps.db
    .selectFrom("media")
    .select(["id", "preview_key", "extractor", "webpage_url"])
    .where("id", "=", mediaId)
    .executeTakeFirst();
  if (media === undefined || media.preview_key !== null) return;
  // Its people's bells show it being made.
  await tell(deps, mediaId);
  const source = await sourceOf(deps, mediaId);
  if (source === undefined) throw new UnrecoverableError("the media has no stored video");
  await mkdir(dir, { recursive: true });
  const output = join(dir, "preview.mp4");
  const page = previewPage(deps, {
    extractor: media.extractor,
    webpageUrl: media.webpage_url,
    profileArgs: source.extra_args,
  });
  const copy =
    page === null
      ? null
      : await downloadPreviewCopy(deps, mediaId, page, join(dir, "site"), signal);
  const run = { deps, mediaId, output, signal };
  if (copy === null || !(await fromCopy(run, copy))) {
    await fromStored(run, source.storage_key);
  }
  await storePreview(deps, mediaId, output);
}

/** One preview being made: where it goes, and what cuts it short. */
interface Run {
  deps: WorkerDeps;
  mediaId: string;
  output: string;
  signal: AbortSignal;
}

/** Encodes the preview from the stored file. */
async function fromStored(run: Run, key: string) {
  const input = await readInput(run.deps, key).catch((err: unknown) => {
    throw new UnrecoverableError("the video's file can't be read", { cause: err });
  });
  await encode(run, await probe(run.deps, input, run.signal), input);
}

/**
 * Encodes `input` on the replica's pipelines in turn (docs/transcoding.md), as its sessions do:
 * from the first the sessions haven't found broken on this kind of source, the CPU last. A GPU run
 * that fails moves this preview on without marking its pipeline failed, as a passing failure
 * (playback holding every encoder session, say) mustn't cost playback the GPU. A cut never moves on.
 */
async function encode(run: Run, info: MediaInfo, input: string): Promise<void> {
  const { deps, mediaId, output, signal } = run;
  const t = deps.transcoder;
  const chain = pipelinesFor(t.hwaccel, t.gpuWorks);
  const video = streamsOf(info).video;
  const first = video === undefined ? "cpu" : choosePipeline(chain, t.memo, sourceKey(video));
  for (const pipeline of chain.slice(chain.indexOf(first))) {
    const args = previewArgs(planFor(info, input, output, pipeline, t.vaapiDevice));
    try {
      await runFfmpeg(deps, args, signal);
      return;
    } catch (err) {
      if (pipeline === "cpu" || signal.aborted) throw err;
      deps.logger.warn({ err, mediaId, pipeline }, "a hover preview's GPU run failed");
    }
  }
}

/**
 * Makes the preview from the site's copy: copied as it is when it already is one, else encoded.
 * False for a copy with no picture, which the stored file stands in for.
 */
async function fromCopy(run: Run, copy: string) {
  const info = await probe(run.deps, copy, run.signal);
  const { video, audio } = streamsOf(info);
  if (video === undefined) return false;
  if (!alreadyPreview(video, audio)) {
    await encode(run, info, copy);
    return true;
  }
  const args = previewCopyArgs({
    input: copy,
    output: run.output,
    video: { index: video.index },
    audio: audio === undefined ? null : { index: audio.index },
  });
  await runFfmpeg(run.deps, args, run.signal);
  return true;
}

/** A file's picture (never a cover image) and its sound, the first of each. */
function streamsOf(info: MediaInfo) {
  return {
    video: info.streams.find((s) => s.type === "video" && !s.attachedPic),
    audio: info.streams.find((s) => s.type === "audio"),
  };
}

/**
 * Whether a copy is a preview already, so copying it is enough: H.264 that every browser plays,
 * 480p at most (the short side), not HDR, at most 2 Mbit/s, with AAC or no sound.
 */
function alreadyPreview(video: MediaStream, audio: MediaStream | undefined): boolean {
  const short = Math.min(video.width ?? Infinity, video.height ?? Infinity);
  return (
    video.codec === "h264" &&
    BROWSER_PIX_FMTS.has(video.pixFmt ?? "") &&
    short <= PREVIEW_SHORT_SIDE &&
    (video.bitRate ?? 0) <= COPY_MAX_BITRATE &&
    !HDR.has(video.colorTransfer ?? "") &&
    (audio === undefined || audio.codec === "aac")
  );
}

async function probe(deps: WorkerDeps, input: string, signal: AbortSignal): Promise<MediaInfo> {
  const t = deps.transcoder;
  return ffprobe(input, { binary: t.ffprobe.binary, ...env(t.ffprobe.env), signal });
}

/** The preview's plan from the file's own streams: 480p at most, on `pipeline`, HDR tone-mapped. */
function planFor(
  info: MediaInfo,
  input: string,
  output: string,
  pipeline: Pipeline,
  vaapiDevice: string,
): PreviewPlan {
  const { video, audio } = streamsOf(info);
  if (video === undefined) throw new UnrecoverableError("the file has no video");
  const size = outputSize(video.width ?? 1280, video.height ?? 720, PREVIEW_SHORT_SIDE);
  const transfer = video.colorTransfer ?? "";
  return {
    input,
    output,
    audio: audio === undefined ? null : { index: audio.index },
    vaapiDevice,
    video: {
      index: video.index,
      pipeline,
      ...size,
      bitrate: PREVIEW_BITRATE,
      level: h264Level(size.width, size.height).idc,
      hdr: HDR.has(transfer) ? (transfer as "smpte2084" | "arib-std-b67") : null,
    },
  };
}

/** One ffmpeg run, writing the clip to its output; its reason when it fails. */
async function runFfmpeg(deps: WorkerDeps, args: string[], signal: AbortSignal): Promise<void> {
  const t = deps.transcoder;
  const proc = spawnStream({ binary: t.ffmpeg.binary, args, ...env(t.ffmpeg.env), signal });
  // Nothing comes on stdout (the clip goes to a file), but an unread pipe would block ffmpeg.
  await buffer(proc.stdout);
  const exit = await proc.exited;
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
  if (exit.code !== 0 || exit.stopped) {
    throw new Error(meaningfulLine(exit.stderrTail) || "ffmpeg failed");
  }
}

/** Stores the clip and records it; a media gone meanwhile takes the file back. */
async function storePreview(deps: WorkerDeps, mediaId: string, output: string): Promise<void> {
  const key = previewKey(mediaId);
  const { size } = await deps.store.put(key, output, "video/mp4");
  const done = await deps.db
    .updateTable("media")
    .set({ preview_key: key, preview_bytes: size, preview_failed_at: null })
    .where("id", "=", mediaId)
    .where("preview_key", "is", null)
    .executeTakeFirst();
  if (done.numUpdatedRows > 0n) return;
  const still = await deps.db
    .selectFrom("media")
    .select("id")
    .where("id", "=", mediaId)
    .executeTakeFirst();
  if (still === undefined) await deps.store.delete(key);
}
