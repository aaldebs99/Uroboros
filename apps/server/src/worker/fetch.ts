import { access, mkdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { download, ffprobe, type DownloadedFile } from "@uroboros/ytdlp";
import { dispatchFor } from "../downloads/dispatch.ts";
import { RequeueError, UnrecoverableError } from "../jobs/errors.ts";
import { StorageError, toDownloadError, type DownloadFailure } from "../downloads/errors.ts";
import { publishDownloadEvents } from "../downloads/events.ts";
import { noticeFinishedRequests } from "../downloads/requestNotices.ts";
import { ytdlpArgsFor } from "../downloads/profiles.ts";
import type { FetchJob } from "../downloads/queues.ts";
import { loginsForFetch } from "../siteLogins/forJobs.ts";
import { renditionKey, sidecarKey, type MediaNames } from "../storage/index.ts";
import { contentTypeOf } from "../storage/contentType.ts";
import { renditionFacts } from "../transcode/facts.ts";
import { indexKeyframes } from "../transcode/keyframes.ts";
import type { WorkerDeps } from "./deps.ts";
import { upsertMedia } from "./media.ts";
import { skipSegmentsFor } from "./skipSegments.ts";
import { createProgressPublisher } from "./progress.ts";
import { storeSubtitles, subtitleArgs, withSubtitleFallback } from "./subtitles.ts";
import { queuePreview } from "../previews/queue.ts";

const ACTIVE = ["queued", "running"] as const;
const DOWNLOAD_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/**
 * Why a fetch was aborted when the process is stopping: not a person's cancel and not a failure,
 * so the job goes back to the queue for another replica and no outcome is recorded.
 */
export class ShutdownAbort extends Error {
  override readonly name = "ShutdownAbort";
  constructor() {
    super("the process is shutting down");
  }
}

/** The run lost its job (its lease lapsed and another run has it): stop, recording nothing. */
class LeaseLost extends Error {
  override readonly name = "LeaseLost";
}

/** Aborts running fetches: one by key (a cancel), or all of them (shutdown). */
export function createCancelRegistry() {
  const running = new Map<string, AbortController>();
  return {
    start(key: string): AbortController {
      const controller = new AbortController();
      running.set(key, controller);
      return controller;
    },
    end(key: string): void {
      running.delete(key);
    },
    cancel(key: string): void {
      running.get(key)?.abort(new Error("cancelled"));
    },
    /** Aborts every running fetch with a `ShutdownAbort`; they go back to the queue. */
    abortAll(): void {
      for (const controller of running.values()) controller.abort(new ShutdownAbort());
    },
  };
}
export type CancelRegistry = ReturnType<typeof createCancelRegistry>;

export interface FetchJobLike {
  id?: string | undefined;
  data: FetchJob;
  attemptsMade: number;
  opts: { attempts?: number | undefined };
  /** Aborts when the run lost its job to another. */
  signal?: AbortSignal;
}

/** How long a fetch cut by shutdown waits before another replica may take it. */
const SHUTDOWN_REQUEUE_DELAY_MS = 1000;

async function waitingUsers(
  deps: WorkerDeps,
  key: string,
): Promise<{ id: string; user_id: string }[]> {
  return deps.db
    .selectFrom("downloads")
    .select(["id", "user_id"])
    .where("fetch_key", "=", key)
    .where("state", "in", ACTIVE)
    .execute();
}

async function publishAll(
  deps: WorkerDeps,
  rows: { id: string; user_id: string }[],
): Promise<void> {
  await publishDownloadEvents(
    deps.db,
    rows.map((r) => ({ kind: "state", downloadId: r.id, userId: r.user_id })),
  );
}

async function dispatchUsers(deps: WorkerDeps, rows: { user_id: string }[]): Promise<void> {
  for (const userId of new Set(rows.map((r) => r.user_id))) await dispatchFor(deps, userId);
}

/** The stored rendition for this fetch, if any (a retry, or someone else's fetch finished). */
async function existingRendition(deps: WorkerDeps, data: FetchJob) {
  return deps.db
    .selectFrom("renditions as r")
    .innerJoin("media as m", "m.id", "r.media_id")
    .select(["r.id", "r.media_id"])
    .where("m.extractor", "=", data.extractor)
    .where("m.video_id", "=", data.videoId)
    .where("r.profile_id", "=", data.profileId)
    .where("r.profile_revision", "=", data.revision)
    .executeTakeFirst();
}

/**
 * Marks every download waiting on the fetch done, gives each person a library entry and queues the
 * video's hover preview. False (settling nothing) when the rendition is gone: the reaper deleted
 * it, so the fetch runs anew.
 */
export async function settleDone(
  deps: WorkerDeps,
  data: FetchJob,
  rendition: { id: string; media_id: string },
): Promise<boolean> {
  const settled = await deps.db.transaction().execute(async (tx) => {
    // Held against the reaper's FOR UPDATE until the entries below are committed.
    const live = await tx
      .selectFrom("renditions")
      .select(["id", "video_codec"])
      .where("id", "=", rendition.id)
      .forKeyShare()
      .executeTakeFirst();
    if (live === undefined) return null;
    const rows = await tx
      .updateTable("downloads")
      .set({
        state: "done",
        rendition_id: rendition.id,
        finished_at: new Date(),
        error_kind: null,
        error_message: null,
      })
      .where("fetch_key", "=", data.fetchKey)
      .where("state", "in", ACTIVE)
      .returning(["id", "user_id", "subscription_id"])
      .execute();
    // One active download per person and fetch key, so one entry each, carrying its subscription.
    for (const r of rows) {
      await tx
        .insertInto("library_entries")
        .values({
          user_id: r.user_id,
          media_id: rendition.media_id,
          rendition_id: rendition.id,
          subscription_id: r.subscription_id,
        })
        .onConflict((oc) => oc.columns(["user_id", "rendition_id"]).doNothing())
        .execute();
    }
    // The video's hover preview, with the entries (so their people hear of it at commit).
    if (deps.generatePreviews && live.video_codec !== null)
      await queuePreview(deps, rendition.media_id, tx);
    return rows;
  });
  if (settled === null) return false;
  await publishAll(deps, settled);
  await dispatchUsers(deps, settled);
  await noticeFinishedRequests(
    deps,
    settled.map((r) => r.id),
  );
  return true;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function put(deps: WorkerDeps, key: string, file: string, ext: string): Promise<number> {
  try {
    return (await deps.store.put(key, file, contentTypeOf(ext))).size;
  } catch (err) {
    throw new StorageError(err instanceof Error ? err.message : String(err), { cause: err });
  }
}

/** Whether `key` is free for this rendition: nobody else's file, and not waiting to be deleted. */
async function keyIsMine(
  deps: WorkerDeps,
  key: string,
  own: { mediaId: string; profileId: string; revision: string },
): Promise<boolean> {
  const holder = await deps.db
    .selectFrom("renditions")
    .select(["media_id", "profile_id", "profile_revision"])
    .where("storage_key", "=", key)
    .executeTakeFirst();
  // A key the reaper has yet to delete is taken too, or its pending delete would take the new file.
  const trashed = await deps.db
    .selectFrom("storage_trash")
    .select("key")
    .where("key", "=", key)
    .executeTakeFirst();
  return (
    trashed === undefined &&
    (holder === undefined ||
      (holder.media_id === own.mediaId &&
        holder.profile_id === own.profileId &&
        holder.profile_revision === own.revision))
  );
}

/**
 * A filesystem layout names files by profile name, not revision, so an edited profile, or two
 * people's profiles of one name, would land on a file other library entries still point at: then
 * the short revision is added before the extension, and if that is taken too (identical profiles
 * of one name), the profile's id as well. (S3 keys already carry both.)
 */
export async function freeKey(
  deps: WorkerDeps,
  key: string,
  own: { mediaId: string; profileId: string; revision: string },
): Promise<string> {
  const ext = extname(key);
  const stem = key.slice(0, key.length - ext.length);
  const rev = own.revision.slice(0, 8);
  const candidates = [
    key,
    `${stem} [${rev}]${ext}`,
    `${stem} [${rev} ${own.profileId.slice(0, 8)}]${ext}`,
  ];
  for (const candidate of candidates.slice(0, -1)) {
    if (await keyIsMine(deps, candidate, own)) return candidate;
  }
  return candidates.at(-1) ?? key;
}

/** Stores the downloaded file and its sidecars, and records the rendition. */
async function store(
  deps: WorkerDeps,
  data: FetchJob,
  file: DownloadedFile,
): Promise<{ id: string; media_id: string }> {
  const probed = await ffprobe(file.path, {
    binary: deps.ffprobe.binary,
    ...(deps.ffprobe.env === undefined ? {} : { env: deps.ffprobe.env }),
  });
  const ext = extname(file.path).slice(1).toLowerCase();
  const info = file.info;
  const names: MediaNames = {
    extractor: data.extractor,
    id: data.videoId,
    title: info.title,
    channel: info.channel,
    uploader: info.uploader,
    uploadDate: info.uploadDate,
    profile: data.profileName,
    ext,
  };
  const mediaId = await upsertMedia(
    deps.db,
    { extractor: data.extractor, videoId: data.videoId },
    info,
  );
  const key = await freeKey(
    deps,
    renditionKey(deps.storage, mediaId, data.profileId, data.revision, names),
    { mediaId, profileId: data.profileId, revision: data.revision },
  );
  const size = await put(deps, key, file.path, ext);
  const thumbnail = file.path.slice(0, -extname(file.path).length) + ".jpg";
  const thumbnailKey = (await exists(thumbnail))
    ? sidecarKey(deps.storage, mediaId, names, "thumbnail", "jpg")
    : null;
  if (thumbnailKey !== null) await put(deps, thumbnailKey, thumbnail, "jpg");
  const infoPath = join(file.path, "..", file.infoJsonPath.split("/").at(-1) ?? "");
  const infoKey = (await exists(infoPath))
    ? sidecarKey(deps.storage, mediaId, names, "info", "json")
    : null;
  if (infoKey !== null) await put(deps, infoKey, infoPath, "json");
  await upsertMedia(deps.db, { extractor: data.extractor, videoId: data.videoId }, info, {
    thumbnailKey,
    infoKey,
  });
  await storeSubtitles(deps, mediaId, key, file);
  const facts = renditionFacts(probed);
  await deps.db
    .insertInto("renditions")
    .values({
      media_id: mediaId,
      profile_id: data.profileId,
      profile_revision: data.revision,
      storage_key: key,
      size_bytes: size,
      container: ext,
      ...facts,
      skip_segments: JSON.stringify(skipSegmentsFor(data.args, info.sponsorSegments ?? [])),
    })
    .onConflict((oc) => oc.columns(["media_id", "profile_id", "profile_revision"]).doNothing())
    .execute();
  const rendition = await existingRendition(deps, data);
  if (rendition === undefined) throw new StorageError("the rendition was not recorded");
  await indexKeyframes(deps, rendition.id, file.path, probed);
  return rendition;
}

/** Records a failure: retryable ones stay running for the queue's next attempt. Returns whether it is final. */
async function recordFailure(
  deps: WorkerDeps,
  job: FetchJobLike,
  failure: DownloadFailure,
): Promise<boolean> {
  const final = !failure.retry || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  const rows = await deps.db
    .updateTable("downloads")
    .set({
      error_kind: failure.kind,
      error_message: failure.message,
      stderr_tail: failure.stderrTail,
      attempts: job.attemptsMade + 1,
      ...(final ? { state: "failed" as const, finished_at: new Date() } : {}),
    })
    .where("fetch_key", "=", job.data.fetchKey)
    .where("state", "in", ACTIVE)
    .returning(["id", "user_id"])
    .execute();
  await publishAll(deps, rows);
  if (final) {
    await dispatchUsers(deps, rows);
    await noticeFinishedRequests(
      deps,
      rows.map((r) => r.id),
    );
  }
  return final;
}

async function markRunning(deps: WorkerDeps, job: FetchJobLike): Promise<void> {
  const rows = await deps.db
    .updateTable("downloads")
    .set({ state: "running", started_at: new Date(), attempts: job.attemptsMade + 1 })
    .where("fetch_key", "=", job.data.fetchKey)
    .where("state", "in", ACTIVE)
    .returning(["id", "user_id"])
    .execute();
  await publishAll(deps, rows);
}

/** Runs yt-dlp into `scratch`, stores the file and settles everyone waiting on the fetch. */
async function downloadAndSettle(
  deps: WorkerDeps,
  data: FetchJob,
  scratch: string,
  signal: AbortSignal,
): Promise<void> {
  const progress = createProgressPublisher(deps.db, data.fetchKey);
  const { format, extraArgs: profileArgs } = ytdlpArgsFor(data.args);
  // Whoever waits on this fetch now: per site, the earliest waiter's saved login.
  const logins = await loginsForFetch(deps.db, deps.ytdlp.secretsKey, data.fetchKey, deps.logger);
  const run = (extraArgs: string[]) =>
    download(data.url, {
      binary: deps.ytdlp.binary,
      ...(deps.ytdlp.env === undefined ? {} : { env: deps.ytdlp.env }),
      logins,
      ...(deps.ytdlp.jsRuntime === undefined ? {} : { jsRuntime: deps.ytdlp.jsRuntime }),
      workDir: scratch,
      format,
      extraArgs,
      signal,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      onProgress: progress,
    });
  const result = await withSubtitleFallback(
    run,
    { profile: profileArgs, subtitles: subtitleArgs(deps.subtitles) },
    signal,
    deps.logger,
  );
  const file = result.files[0];
  if (file === undefined) throw new StorageError("yt-dlp finished without a file");
  progress({ phase: "storing" });
  if (!(await settleDone(deps, data, await store(deps, data, file)))) {
    throw new StorageError("the rendition was not recorded");
  }
}

/** Downloads one video in one profile revision and settles everyone waiting on it. */
export function fetchProcessor(deps: WorkerDeps, cancels: CancelRegistry) {
  return async (job: FetchJobLike): Promise<void> => {
    const data = job.data;
    if ((await waitingUsers(deps, data.fetchKey)).length === 0) return;
    const stored = await existingRendition(deps, data);
    if (stored !== undefined && (await settleDone(deps, data, stored))) return;
    const controller = cancels.start(data.fetchKey);
    job.signal?.addEventListener(
      "abort",
      () => {
        controller.abort(new LeaseLost());
      },
      { once: true },
    );
    const scratch = join(deps.workDir, encodeURIComponent(data.fetchKey));
    try {
      await markRunning(deps, job);
      await rm(scratch, { recursive: true, force: true });
      await mkdir(scratch, { recursive: true });
      await downloadAndSettle(deps, data, scratch, controller.signal);
    } catch (err) {
      if (controller.signal.reason instanceof ShutdownAbort) {
        // Back to the queue as it was: no failure, no cancel, and no attempt spent.
        deps.logger.info({ fetchKey: data.fetchKey }, "fetch cut by shutdown; requeued");
        throw new RequeueError(SHUTDOWN_REQUEUE_DELAY_MS, { cause: err });
      }
      if (controller.signal.reason instanceof LeaseLost) {
        // Another run has the job now: it records how the fetch ends.
        deps.logger.warn({ fetchKey: data.fetchKey }, "fetch lost its job to another run; stopped");
        return;
      }
      if (controller.signal.aborted) {
        // Someone may have started waiting while the cancel was on its way; their dispatch found
        // this job still live and added nothing, so the fetch must run again for them.
        if ((await waitingUsers(deps, data.fetchKey)).length === 0) return;
        throw new Error("cancelled while someone still waits; retrying", { cause: err });
      }
      const failure = toDownloadError(err);
      deps.logger.warn({ err, fetchKey: data.fetchKey, kind: failure.kind }, "fetch failed");
      if (await recordFailure(deps, job, failure)) throw new UnrecoverableError(failure.message);
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      cancels.end(data.fetchKey);
      await rm(scratch, { recursive: true, force: true });
    }
  };
}
