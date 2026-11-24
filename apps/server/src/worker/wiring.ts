import type { Kysely } from "kysely";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { Config } from "../config.ts";
import type { Database } from "../db/schema.ts";
import type { DownloadQueues } from "../downloads/queues.ts";
import type { PushService } from "../push/service.ts";
import type { MediaStore } from "../storage/index.ts";
import type { PlaybackBus } from "../transcode/bus.ts";
import type { WorkerDeps } from "./deps.ts";

/** The connections a server process opens once and shares between HTTP and its job consumers. */
export interface SharedResources {
  db: Kysely<Database>;
  /** A non-blocking connection: progress and events, queue producers. */
  valkey: Redis;
  queues: DownloadQueues;
  store: MediaStore;
  push: PushService;
  /** The replica's playback sessions bus (want/ready/stop). */
  playbackBus: PlaybackBus;
}

/** What the probe and fetch processors run with, on the process's shared connections. */
export function workerDeps(
  shared: SharedResources,
  config: Config,
  prefix: string,
  logger: Logger,
): WorkerDeps {
  return {
    db: shared.db,
    valkey: shared.valkey,
    prefix,
    queues: shared.queues,
    limits: config.downloads,
    logger,
    store: shared.store,
    storage: config.storage,
    workDir: config.worker.workDir,
    // The process's own Node solves sites' JavaScript challenges (yt-dlp-ejs).
    ytdlp: {
      binary: config.worker.ytdlpPath,
      cookiesFile: config.worker.cookiesFile,
      secretsKey: config.secretsKey,
      jsRuntime: process.execPath,
    },
    ffprobe: { binary: "ffprobe" },
    subtitles: config.worker.subtitles,
    push: shared.push,
    ffmpeg: { binary: "ffmpeg" },
    transcodeConcurrency: config.worker.transcode.concurrency,
  };
}
