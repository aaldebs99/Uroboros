import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { Config } from "../config.ts";
import type { Database } from "../db/schema.ts";
import type { DownloadQueues } from "../downloads/queues.ts";
import type { PushService } from "../push/service.ts";
import { SPONSORBLOCK_API, sponsorBlockClient } from "../sponsorblock/client.ts";
import type { MediaStore } from "../storage/index.ts";
import type { PlaybackBus } from "../transcode/bus.ts";
import { transcoderPaths } from "../transcode/binaries.ts";
import { PipelineMemo } from "../transcode/hwaccel.ts";
import type { WorkerDeps } from "./deps.ts";
import type { PgBus } from "../db/notifications.ts";

/** The connections a server process opens once and shares between HTTP and its job consumers. */
export interface SharedResources {
  db: Kysely<Database>;
  /** The process's listener connection: download events, cancels and job wakes. */
  bus: PgBus;
  queues: DownloadQueues;
  store: MediaStore;
  push: PushService;
  /** The replica's playback sessions bus (want/ready/stop). */
  playbackBus: PlaybackBus;
}

/** What the probe and fetch processors run with, on the process's shared connections. */
export function workerDeps(shared: SharedResources, config: Config, logger: Logger): WorkerDeps {
  return {
    db: shared.db,
    queues: shared.queues,
    limits: config.downloads,
    logger,
    store: shared.store,
    storage: config.storage,
    workDir: config.worker.workDir,
    // The process's own Node solves sites' JavaScript challenges (yt-dlp-ejs).
    ytdlp: {
      binary: config.worker.ytdlpPath,
      secretsKey: config.secretsKey,
      jsRuntime: process.execPath,
    },
    ffprobe: { binary: "ffprobe" },
    ffmpeg: { binary: "ffmpeg" },
    subtitles: config.worker.subtitles,
    push: shared.push,
    transcodeConcurrency: config.worker.transcode.concurrency,
    playbackBus: shared.playbackBus,
    transcoder: transcoderFor(config),
    generatePreviews: config.worker.generatePreviews,
    sponsorBlock: sponsorBlockClient({ baseUrl: SPONSORBLOCK_API }),
  };
}

/** The transcoder's binaries and this replica's GPU; the startup test may turn the GPU off. */
function transcoderFor(config: Config): WorkerDeps["transcoder"] {
  const paths = transcoderPaths();
  return {
    ffmpeg: { binary: paths.ffmpeg },
    ffprobe: { binary: paths.ffprobe },
    hwaccel: config.worker.transcode.hwaccel,
    vaapiDevice: config.worker.transcode.vaapiDevice,
    gpuWorks: true,
    memo: new PipelineMemo(),
  };
}
