import { ffprobe, grabFrame } from "@uroboros/ytdlp";
import { sql } from "kysely";
import type { UploadJob } from "../downloads/queues.ts";
import { RequeueError, UnrecoverableError } from "../jobs/errors.ts";
import type { Processor } from "../jobs/queues.ts";
import { UPLOAD_EXTRACTOR } from "../library/platform.ts";
import { contentTypeOf } from "../storage/contentType.ts";
import { renditionFacts } from "../transcode/facts.ts";
import type { WorkerDeps } from "../worker/deps.ts";
import { dayOf, uploadThumbnailKey } from "./keys.ts";
import { FAILED_NO_VIDEO, FAILED_OTHERWISE, failUpload, type UploadRow } from "./store.ts";

/**
 * The `upload` job (docs/uploads.md): puts a finished upload's parts together in the store, checks
 * there is a video in it, grabs a frame when its person sent no thumbnail, and files it as a media
 * row of its own with a profile-less rendition and the person's entry, in one transaction.
 */

/** A cut for shutdown goes back to the queue this soon, on any replica. */
const SHUTDOWN_REQUEUE_DELAY_MS = 1000;
/** ffprobe's time on a stored upload (it reads the header, or an S3 URL's). */
const PROBE_TIMEOUT_MS = 5 * 60_000;
/** The frame comes from a tenth of the way in, but no later than a minute. */
const FRAME_AT = (duration: number | null) =>
  duration === null ? 0 : Math.min(duration * 0.1, 60);

class NoVideo extends UnrecoverableError {}
class ShutdownCut extends Error {}

const env = (e: Record<string, string> | undefined) => (e === undefined ? {} : { env: e });

export interface UploadProcessor {
  process: Processor<UploadJob>;
  /** Cuts every running upload for shutdown; each goes back to its queue. */
  abortAll(): void;
}

export function uploadProcessor(deps: WorkerDeps): UploadProcessor {
  const running = new Set<AbortController>();
  return {
    abortAll() {
      for (const cut of running) cut.abort(new ShutdownCut("the replica is shutting down"));
    },
    async process(job) {
      const cut = new AbortController();
      running.add(cut);
      const { uploadId } = job.data;
      try {
        await fileUpload(deps, uploadId, AbortSignal.any([job.signal, cut.signal]));
      } catch (err) {
        if (cut.signal.aborted) throw new RequeueError(SHUTDOWN_REQUEUE_DELAY_MS, { cause: err });
        // A run that lost its job records nothing: the run holding it now does.
        if (job.signal.aborted) throw err;
        const last = err instanceof UnrecoverableError || job.attemptsMade + 1 >= job.opts.attempts;
        if (last) {
          const message = err instanceof NoVideo ? FAILED_NO_VIDEO : FAILED_OTHERWISE;
          if (await failUpload(deps.db, deps.store, uploadId, message)) {
            deps.logger.warn({ err, uploadId }, "upload failed");
          }
        }
        throw err;
      } finally {
        running.delete(cut);
      }
    },
  };
}

async function fileUpload(deps: WorkerDeps, id: string, signal: AbortSignal): Promise<void> {
  const row = await deps.db
    .selectFrom("uploads")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (row?.state !== "processing") return;
  if (row.user_id === null) throw new UnrecoverableError("the upload's account is gone");
  const parts = await deps.db
    .selectFrom("upload_parts")
    .select(["n", "etag", "checksum"])
    .where("upload_id", "=", id)
    .orderBy("n")
    .execute();
  await deps.store.completeUpload(
    row.storage_key,
    row.store_upload_id,
    parts,
    Number(row.size_bytes),
  );
  const input =
    deps.store.localPath(row.storage_key) ?? (await deps.store.readUrl(row.storage_key));
  if (input === null) throw new Error("the stored upload can't be read");
  const info = await ffprobe(input, {
    binary: deps.ffprobe.binary,
    ...env(deps.ffprobe.env),
    signal,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const facts = renditionFacts(info);
  if (facts.video_codec === null) throw new NoVideo("the upload has no video stream");
  const frameKey =
    row.thumbnail_key === null ? await frame(deps, row, input, info.duration, signal) : null;
  const filed = await deps.db.transaction().execute(async (tx) => {
    // Under the row's lock: a run that lost its job and finished anyway files nothing twice.
    const up = await tx
      .selectFrom("uploads")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (up?.state !== "processing" || up.user_id === null) return false;
    const thumbnail = up.thumbnail_key ?? frameKey;
    await tx
      .insertInto("media")
      .values({
        id: up.media_id,
        extractor: UPLOAD_EXTRACTOR,
        video_id: up.id,
        title: up.title,
        description: up.description,
        channel: up.creator,
        uploader: up.creator,
        upload_date: dayOf(up.created_at),
        duration: info.duration,
        thumbnail_key: thumbnail,
        uploaded_by: up.user_id,
      })
      .execute();
    const rendition = await tx
      .insertInto("renditions")
      .values({
        media_id: up.media_id,
        profile_id: null,
        profile_revision: "upload",
        storage_key: up.storage_key,
        size_bytes: Number(up.size_bytes),
        container: up.ext,
        ...facts,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const entry = await tx
      .insertInto("library_entries")
      .values({ user_id: up.user_id, media_id: up.media_id, rendition_id: rendition.id })
      .returning("id")
      .executeTakeFirstOrThrow();
    if (up.tags.length > 0) {
      await tx
        .insertInto("entry_tags")
        .values(up.tags.map((tag) => ({ entry_id: entry.id, tag })))
        .execute();
    }
    await tx
      .updateTable("uploads")
      .set({ state: "done", entry_id: entry.id, thumbnail_key: thumbnail, touched_at: sql`now()` })
      .where("id", "=", id)
      .execute();
    await tx.deleteFrom("upload_parts").where("upload_id", "=", id).execute();
    return true;
  });
  if (!filed && frameKey !== null) await deps.store.delete(frameKey);
}

/** A frame of the video as its thumbnail; none (logged) when ffmpeg can't take one. */
async function frame(
  deps: WorkerDeps,
  row: UploadRow,
  input: string,
  duration: number | null,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const bytes = await grabFrame(input, {
      binary: deps.ffmpeg.binary,
      ...env(deps.ffmpeg.env),
      signal,
      atSeconds: FRAME_AT(duration),
    });
    const key = uploadThumbnailKey(deps.storage, row.storage_key, row.media_id, row.title, "jpg");
    await deps.store.putBytes(key, bytes, contentTypeOf("jpg"));
    return key;
  } catch (err) {
    if (signal.aborted) throw err;
    deps.logger.warn({ err, uploadId: row.id }, "no frame for an upload's thumbnail");
    return null;
  }
}
