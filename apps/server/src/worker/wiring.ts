import type { Redis } from "ioredis";
import type { Logger } from "pino";
import type { WorkerConfig } from "../config.ts";
import { createDb } from "../db/kysely.ts";
import { createDownloadQueues } from "../downloads/queues.ts";
import { createValkey } from "../shared/valkey.ts";
import { createStore } from "../storage/index.ts";
import { startDownloadWorkers, type DownloadWorkers } from "./downloadWorkers.ts";

/**
 * The download side of a worker process: its database pool, store, queue producers (to dispatch the
 * next download) and event connection. `start` runs the consumers on the worker's own connection;
 * `close` releases the rest once the workers have drained.
 */
export function downloadWiring(config: WorkerConfig, prefix: string, logger: Logger) {
  const db = createDb(config.databaseUrl, logger);
  const valkey: Redis = createValkey(config.valkeyUrl, "worker", logger);
  const queues = createDownloadQueues(valkey, prefix);
  return {
    start(connection: Redis): Promise<DownloadWorkers> {
      return startDownloadWorkers(
        connection,
        {
          db,
          valkey,
          prefix,
          queues,
          limits: config.downloads,
          logger,
          store: createStore(config.storage),
          storage: config.storage,
          workDir: config.workDir,
          // The worker's own Node solves sites' JavaScript challenges (yt-dlp-ejs).
          ytdlp: {
            binary: config.ytdlpPath,
            cookiesFile: config.cookiesFile,
            jsRuntime: process.execPath,
          },
          ffprobe: { binary: "ffprobe" },
          subtitles: config.subtitles,
        },
        { prefix, concurrency: config.concurrency },
      );
    },
    async close(): Promise<void> {
      await queues.close().catch(() => undefined);
      valkey.disconnect();
      await db.destroy();
    },
  };
}
