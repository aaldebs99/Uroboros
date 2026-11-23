import { access, mkdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { download, ffprobe, type DownloadedFile, type MediaInfo } from "@uroboros/ytdlp";
import { UnrecoverableError } from "bullmq";
import { dispatchFor } from "../downloads/dispatch.ts";
import { StorageError, toDownloadError, type DownloadFailure } from "../downloads/errors.ts";
import { publishDownloadEvent } from "../downloads/events.ts";
import { ytdlpArgsFor } from "../downloads/profiles.ts";
import type { FetchJob } from "../downloads/queues.ts";
import { renditionKey, sidecarKey, type MediaNames } from "../storage/index.ts";
import type { WorkerDeps } from "./deps.ts";
import { upsertMedia } from "./media.ts";
import { createProgressPublisher } from "./progress.ts";

const ACTIVE = ["queued", "running"] as const;
const DOWNLOAD_TIMEOUT_MS = 6 * 60 * 60 * 1000;

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4a: "audio/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  jpg: "image/jpeg",
  json: "application/json",
};
export const contentTypeOf = (ext: string): string =>
  CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";

/** Aborts running fetches by key; the cancel subscriber calls `cancel`. */
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
  };
}
export type CancelRegistry = ReturnType<typeof createCancelRegistry>;

export interface FetchJobLike {
  id?: string | undefined;
  data: FetchJob;
  attemptsMade: number;
  opts: { attempts?: number | undefined };
}

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
  for (const r of rows) {
    await publishDownloadEvent(deps.valkey, deps.prefix, {
      kind: "state",
      downloadId: r.id,
      userId: r.user_id,
    });
  }
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

/** Marks every download waiting on the fetch done and gives each person a library entry. */
async function settleDone(
  deps: WorkerDeps,
  data: FetchJob,
  rendition: { id: string; media_id: string },
) {
  const settled = await deps.db.transaction().execute(async (tx) => {
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
      .returning(["id", "user_id"])
      .execute();
    for (const userId of new Set(rows.map((r) => r.user_id))) {
      await tx
        .insertInto("library_entries")
        .values({ user_id: userId, media_id: rendition.media_id, rendition_id: rendition.id })
        .onConflict((oc) => oc.columns(["user_id", "rendition_id"]).doNothing())
        .execute();
    }
    return rows;
  });
  await publishAll(deps, settled);
  await dispatchUsers(deps, settled);
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

function codecs(info: MediaInfo) {
  const video = info.streams.find((s) => s.type === "video");
  const audio = info.streams.find((s) => s.type === "audio");
  return {
    video_codec: video?.codec ?? null,
    audio_codec: audio?.codec ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    duration: info.duration,
  };
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
  const key = renditionKey(deps.storage, mediaId, data.profileId, data.revision, names);
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
  await deps.db
    .insertInto("renditions")
    .values({
      media_id: mediaId,
      profile_id: data.profileId,
      profile_revision: data.revision,
      storage_key: key,
      size_bytes: size,
      container: ext,
      ...codecs(probed),
    })
    .onConflict((oc) => oc.columns(["media_id", "profile_id", "profile_revision"]).doNothing())
    .execute();
  const rendition = await existingRendition(deps, data);
  if (rendition === undefined) throw new StorageError("the rendition was not recorded");
  return rendition;
}

/** Records a failure: retryable ones stay running for BullMQ's next attempt. Returns whether it is final. */
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
  if (final) await dispatchUsers(deps, rows);
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

/** Downloads one video in one profile revision and settles everyone waiting on it. */
export function fetchProcessor(deps: WorkerDeps, cancels: CancelRegistry) {
  return async (job: FetchJobLike): Promise<void> => {
    const data = job.data;
    if ((await waitingUsers(deps, data.fetchKey)).length === 0) return;
    const stored = await existingRendition(deps, data);
    if (stored !== undefined) {
      await settleDone(deps, data, stored);
      return;
    }
    const controller = cancels.start(data.fetchKey);
    const scratch = join(deps.workDir, encodeURIComponent(data.fetchKey));
    try {
      await markRunning(deps, job);
      await rm(scratch, { recursive: true, force: true });
      await mkdir(scratch, { recursive: true });
      const progress = createProgressPublisher(deps.valkey, deps.prefix, data.fetchKey);
      const { format, extraArgs } = ytdlpArgsFor(data.args);
      const result = await download(data.url, {
        binary: deps.ytdlp.binary,
        ...(deps.ytdlp.env === undefined ? {} : { env: deps.ytdlp.env }),
        ...(deps.ytdlp.cookiesFile === null ? {} : { cookiesFile: deps.ytdlp.cookiesFile }),
        workDir: scratch,
        format,
        extraArgs,
        signal: controller.signal,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        onProgress: progress,
      });
      const file = result.files[0];
      if (file === undefined) throw new StorageError("yt-dlp finished without a file");
      progress({ phase: "storing" });
      await settleDone(deps, data, await store(deps, data, file));
    } catch (err) {
      if (controller.signal.aborted) return;
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
