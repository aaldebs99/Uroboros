import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import {
  ffprobe,
  meaningfulLine,
  previewArgs,
  spawnStream,
  type PreviewPlan,
} from "@uroboros/ytdlp";
import { sql } from "kysely";
import type { PreviewJob } from "../downloads/queues.ts";
import { RequeueError, UnrecoverableError } from "../jobs/errors.ts";
import type { Processor } from "../jobs/queues.ts";
import { previewKey } from "../previews/queue.ts";
import { h264Level, outputSize } from "../transcode/ladder.ts";
import type { WorkerDeps } from "./deps.ts";
import { readInput } from "./sessionSource.ts";

/**
 * The `preview` job (docs/library.md "Hover previews"): cuts a media's hover preview, two seconds
 * from each fifth of the video (or the whole of a short one), at 480p without sound, on the CPU
 * with the transcoder's ffmpeg, and stores it beside the thumbnail.
 */

/** The preview's short side, and the most it may run at. */
export const PREVIEW_SHORT_SIDE = 480;
const PREVIEW_BITRATE = 1_000_000;
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
      const cut = new AbortController();
      running.add(cut);
      const { mediaId } = job.data;
      const dir = join(deps.workDir, `preview-${mediaId}`);
      try {
        await makePreview(deps, mediaId, dir, AbortSignal.any([job.signal, cut.signal]));
      } catch (err) {
        if (cut.signal.aborted) throw new RequeueError(SHUTDOWN_REQUEUE_DELAY_MS, { cause: err });
        if (job.signal.aborted) throw err;
        const last = err instanceof UnrecoverableError || job.attemptsMade + 1 >= job.opts.attempts;
        if (last) await failPreview(deps, mediaId, err);
        throw err;
      } finally {
        running.delete(cut);
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
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

/** The media's stored video to read: the smallest at least 480p (cheapest to decode), else the tallest. */
async function sourceOf(deps: WorkerDeps, mediaId: string) {
  return deps.db
    .selectFrom("renditions")
    .select(["storage_key", "height"])
    .where("media_id", "=", mediaId)
    .where("video_codec", "is not", null)
    .where("orphaned_at", "is", null)
    .orderBy(sql`coalesce(height, 0) >= ${PREVIEW_SHORT_SIDE}`, "desc")
    .orderBy(
      sql`CASE WHEN coalesce(height, 0) >= ${PREVIEW_SHORT_SIDE} THEN height ELSE -coalesce(height, 0) END`,
    )
    .executeTakeFirst();
}

async function makePreview(deps: WorkerDeps, mediaId: string, dir: string, signal: AbortSignal) {
  const media = await deps.db
    .selectFrom("media")
    .select(["id", "preview_key"])
    .where("id", "=", mediaId)
    .executeTakeFirst();
  if (media === undefined || media.preview_key !== null) return;
  const source = await sourceOf(deps, mediaId);
  if (source === undefined) throw new UnrecoverableError("the media has no stored video");
  const input = await readInput(deps, source.storage_key).catch((err: unknown) => {
    throw new UnrecoverableError("the video's file can't be read", { cause: err });
  });
  await mkdir(dir, { recursive: true });
  const plan = await planFor(deps, input, join(dir, "preview.mp4"), signal);
  await encode(deps, plan, signal);
  await storePreview(deps, mediaId, plan.output);
}

/** The clip's plan from the file's own streams: 480p at most, on the CPU, HDR tone-mapped. */
async function planFor(
  deps: WorkerDeps,
  input: string,
  output: string,
  signal: AbortSignal,
): Promise<PreviewPlan> {
  const t = deps.transcoder;
  const info = await ffprobe(input, { binary: t.ffprobe.binary, ...env(t.ffprobe.env), signal });
  const video = info.streams.find((s) => s.type === "video" && !s.attachedPic);
  if (video === undefined) throw new UnrecoverableError("the file has no video");
  if (info.duration === null || info.duration <= 0) {
    throw new UnrecoverableError("the file's length is unknown");
  }
  const size = outputSize(video.width ?? 1280, video.height ?? 720, PREVIEW_SHORT_SIDE);
  const transfer = video.colorTransfer ?? "";
  return {
    input,
    output,
    duration: info.duration,
    video: {
      index: video.index,
      pipeline: "cpu",
      ...size,
      bitrate: PREVIEW_BITRATE,
      level: h264Level(size.width, size.height).idc,
      hdr: HDR.has(transfer) ? (transfer as "smpte2084" | "arib-std-b67") : null,
    },
  };
}

/** One ffmpeg run, writing the clip to the plan's output; its reason when it fails. */
async function encode(deps: WorkerDeps, plan: PreviewPlan, signal: AbortSignal): Promise<void> {
  const t = deps.transcoder;
  const proc = spawnStream({
    binary: t.ffmpeg.binary,
    args: previewArgs(plan),
    ...env(t.ffmpeg.env),
    signal,
  });
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
  await deps.store.put(key, output, "video/mp4");
  const done = await deps.db
    .updateTable("media")
    .set({ preview_key: key, preview_failed_at: null })
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
