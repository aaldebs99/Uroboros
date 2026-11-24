import type { Logger } from "pino";
import { pino } from "pino";
import { ConfigError, loadConfig } from "../config.ts";
import type { Config } from "../config.ts";
import { runUntilSignal, startApi } from "../api/main.ts";
import type { RunningApi, StartApiOptions } from "../api/main.ts";
import { startDownloadWorkers } from "../worker/downloadWorkers.ts";
import { DEFAULT_PREFIX } from "../worker/queues.ts";
import { DEFAULT_SHUTDOWN_GRACE_MS, startWorker } from "../worker/start.ts";
import type { StartWorkerOptions } from "../worker/start.ts";
import { transcoderPaths } from "../transcode/binaries.ts";
import { logToolVersions } from "../worker/versions.ts";
import { workerDeps } from "../worker/wiring.ts";

export interface StartServerOptions extends Omit<StartApiOptions, "consumers"> {
  /** Test seam: passed to `startWorker` (grace, a hanging processor, the system queue's name). */
  worker?: Partial<Pick<StartWorkerOptions, "shutdownGraceMs" | "queueName" | "processor">>;
}

/**
 * One Uroboros replica, Djinn's `serve`: HTTP, migrations and the leader's duties (`startApi`),
 * and, once the database is attached, the job consumers (the system, probe and download queues)
 * on the same connections. Installs no process handlers; the caller owns shutdown.
 */
export function startServer(
  config: Config,
  logger: Logger,
  opts: StartServerOptions = {},
): Promise<RunningApi> {
  const { worker: workerOverrides = {}, ...apiOptions } = opts;
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  return startApi(config, logger, {
    ...apiOptions,
    consumers: {
      graceMs: workerOverrides.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
      start: (shared, signal) =>
        startWorker({
          valkeyUrl: config.valkeyUrl,
          concurrency: config.worker.concurrency,
          prefix,
          logger,
          abort: signal,
          extraWorkers: (connection) =>
            startDownloadWorkers(connection, workerDeps(shared, config, prefix, logger), {
              prefix,
              concurrency: config.worker.concurrency,
              bus: shared.bus,
            }),
          ...workerOverrides,
        }),
    },
  });
}

/**
 * Runs one replica until SIGTERM/SIGINT; resolves with the exit code (0 clean, 1 failed start-up
 * or a failed or overrun shutdown, 2 configuration). bin/server.ts exits the process with it.
 */
export async function main(_argv: string[] = []): Promise<number> {
  const logger = pino({ name: "uroboros" });
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.fatal(err.message);
      return 2;
    }
    throw err;
  }
  await logToolVersions(logger, {
    ytdlp: config.worker.ytdlpPath,
    transcoder: transcoderPaths().ffmpeg,
  });
  return runUntilSignal(await startServer(config, logger), logger);
}
