import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { ffprobe, transcodeHls } from "@uroboros/ytdlp";
import { sql } from "kysely";
import type { TranscodeRow } from "../transcode/playlists.ts";
import { attemptPrefix, transcodePrefix } from "../transcode/keys.ts";
import { chooseMode, type CopyChoice } from "../transcode/plan.ts";
import type { TranscodeJob } from "../transcode/queue.ts";
import { TRANSCODE } from "../transcode/settings.ts";
import { createUploader } from "../transcode/uploader.ts";
import type { WorkerDeps } from "./deps.ts";

/** A copy nobody has asked about for this long, with nothing stored, is dropped at start. */
const ABANDONED_MS = 10 * 60_000;
/** How often a running copy stores its new segments and checks it still exists. */
const TICK_MS = 2000;
const TIMEOUT_MS = 6 * 60 * 60_000;

/** Thrown when the copy's row went away mid-run (its source was reaped). */
class CopyGone extends Error {}

/** Ticks that fail in a row (storage or the database down) before the copy gives up. */
const TICK_FAILURES = 3;

const load = (deps: WorkerDeps, id: string) =>
  deps.db.selectFrom("transcodes").selectAll().where("id", "=", id).executeTakeFirst();

async function trash(deps: WorkerDeps, key: string): Promise<void> {
  await deps.db
    .insertInto("storage_trash")
    .values({ key })
    .onConflict((oc) => oc.column("key").doNothing())
    .execute();
}

/** Deletes an abandoned copy; true when it was one. */
async function dropAbandoned(deps: WorkerDeps, row: TranscodeRow): Promise<boolean> {
  const idle = Date.now() - new Date(row.last_used_at).getTime();
  if (idle < ABANDONED_MS || row.ready_segments > 0) return false;
  await deps.db.deleteFrom("transcodes").where("id", "=", row.id).execute();
  return true;
}

/** Marks the copy running; a run after a cut writes the next attempt and trashes the last. */
async function start(deps: WorkerDeps, row: TranscodeRow): Promise<number> {
  const attempt = row.started_at === null ? row.attempt : row.attempt + 1;
  if (attempt !== row.attempt) await trash(deps, attemptPrefix(row.id, row.attempt));
  await deps.db
    .updateTable("transcodes")
    .set({
      state: "running",
      attempt,
      started_at: new Date(),
      ready_segments: 0,
      progress: 0,
      error_message: null,
    })
    .where("id", "=", row.id)
    .execute();
  return attempt;
}

/** The source file on this machine: the filesystem store's own, or a scratch copy from S3. */
async function sourceFile(deps: WorkerDeps, row: TranscodeRow, scratch: string): Promise<string> {
  const r = await deps.db
    .selectFrom("renditions")
    .select(["storage_key", "container"])
    .where("id", "=", row.source_rendition_id)
    .executeTakeFirst();
  if (r === undefined) throw new CopyGone();
  const local = deps.store.localPath(r.storage_key);
  if (local !== null) return local;
  const path = join(scratch, `source.${r.container ?? "bin"}`);
  const opened = await deps.store.open(r.storage_key);
  await pipeline(Readable.fromWeb(opened.body as never), createWriteStream(path));
  return path;
}

async function describe(
  deps: WorkerDeps,
  id: string,
  source: string,
): Promise<CopyChoice & { duration: number | null }> {
  const info = await ffprobe(source, {
    binary: deps.ffprobe.binary,
    ...(deps.ffprobe.env === undefined ? {} : { env: deps.ffprobe.env }),
  });
  const choice = chooseMode(info);
  await deps.db
    .updateTable("transcodes")
    .set({
      mode: choice.mode,
      codecs: choice.codecs,
      resolution: choice.resolution,
      duration: info.duration,
    })
    .where("id", "=", id)
    .execute();
  return { ...choice, duration: info.duration };
}

interface Running {
  deps: WorkerDeps;
  row: TranscodeRow;
  attempt: number;
  source: string;
  out: string;
  choice: CopyChoice & { duration: number | null };
  signal: AbortSignal | undefined;
}

/** Runs ffmpeg, storing segments and progress every tick; aborts if the row goes away. */
async function convert(r: Running): Promise<number> {
  const { deps, row, out, choice } = r;
  const type = choice.mode === "audio" ? "audio/mp4" : "video/mp4";
  const uploader = createUploader(deps.store, attemptPrefix(row.id, r.attempt), type);
  const cut = new AbortController();
  r.signal?.addEventListener(
    "abort",
    () => {
      cut.abort(r.signal?.reason);
    },
    { once: true },
  );
  let seconds = 0;
  // An object, so the checks after the await see what the tick set.
  const state: { gone: boolean; failures: number; error: unknown } = {
    gone: false,
    failures: 0,
    error: null,
  };
  let ticking = Promise.resolve();
  const tick = () => {
    // Never rejects: an unhandled rejection would take the whole process down (downloads and
    // HTTP with it). A failed tick is retried on the next one; enough in a row stop the copy.
    ticking = ticking
      .then(async () => {
        const ready = await uploader.sync(out);
        const progress = choice.duration ? Math.min(1, seconds / choice.duration) : 0;
        const res = await deps.db
          .updateTable("transcodes")
          .set({ ready_segments: ready, progress })
          .where("id", "=", row.id)
          .executeTakeFirst();
        state.failures = 0;
        if (res.numUpdatedRows === 0n) {
          state.gone = true;
          cut.abort(new CopyGone());
        }
      })
      .catch((err: unknown) => {
        state.failures++;
        state.error = err;
        deps.logger.warn({ err, transcodeId: row.id }, "storing a playback copy's progress failed");
        if (state.failures >= TICK_FAILURES) cut.abort(err);
      });
  };
  const timer = setInterval(tick, TICK_MS);
  try {
    await transcodeHls(
      {
        input: r.source,
        mode: choice.mode,
        encoder: row.encoder,
        copyAudio: choice.copyAudio,
        hdr: choice.hdr,
        segmentSeconds: TRANSCODE.segmentSeconds,
      },
      {
        binary: deps.ffmpeg.binary,
        ...(deps.ffmpeg.env === undefined ? {} : { env: deps.ffmpeg.env }),
        cwd: out,
        signal: cut.signal,
        timeoutMs: TIMEOUT_MS,
        onProgress: (s) => {
          seconds = s;
        },
      },
    );
  } catch (err) {
    if (state.gone) throw new CopyGone();
    // Stopped because storing kept failing: that failure is the copy's error, not ffmpeg's cut.
    if (state.failures >= TICK_FAILURES) throw state.error;
    throw err;
  } finally {
    clearInterval(timer);
    await ticking.catch(() => undefined);
  }
  if (state.gone) throw new CopyGone();
  return uploader.sync(out, true);
}

async function finish(deps: WorkerDeps, id: string, ready: number): Promise<void> {
  await deps.db
    .updateTable("transcodes")
    .set({ state: "done", ready_segments: ready, progress: 1, finished_at: new Date() })
    .where("id", "=", id)
    .execute();
}

async function fail(deps: WorkerDeps, id: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  deps.logger.warn({ err, transcodeId: id }, "a playback copy failed");
  await deps.db
    .updateTable("transcodes")
    .set({ state: "failed", error_message: message.slice(0, 500), finished_at: new Date() })
    .where("id", "=", id)
    .execute();
}

/** A run cut by shutdown: back to queued, so the job's next run starts a fresh attempt. */
async function requeue(deps: WorkerDeps, id: string): Promise<void> {
  await deps.db
    .updateTable("transcodes")
    .set({ state: "queued", last_used_at: sql<Date>`greatest(last_used_at, now())` })
    .where("id", "=", id)
    .execute();
}

/**
 * The `transcode` queue's consumer (docs/transcoding.md): makes one compatible copy, storing its
 * files as ffmpeg finishes them. A copy deleted meanwhile stops and leaves nothing behind; a
 * shutdown (`signal`) puts it back to queued and rethrows, so BullMQ runs it again.
 */
export function transcodeProcessor(deps: WorkerDeps, signal?: AbortSignal) {
  return async (job: { data: TranscodeJob }): Promise<void> => {
    const row = await load(deps, job.data.transcodeId);
    if (row === undefined || row.state === "done" || (await dropAbandoned(deps, row))) return;
    const attempt = await start(deps, row);
    const scratch = join(deps.workDir, `transcode-${row.id}-${String(attempt)}`);
    const out = join(scratch, "out");
    try {
      await mkdir(out, { recursive: true });
      const source = await sourceFile(deps, row, scratch);
      const choice = await describe(deps, row.id, source);
      const ready = await convert({ deps, row, attempt, source, out, choice, signal });
      await finish(deps, row.id, ready);
    } catch (err) {
      if (err instanceof CopyGone) {
        await trash(deps, transcodePrefix(row.id));
        return;
      }
      if (signal?.aborted === true) {
        await requeue(deps, row.id);
        throw err;
      }
      await fail(deps, row.id, err);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  };
}
