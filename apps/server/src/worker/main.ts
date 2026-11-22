import { hostname } from "node:os";
import type { Processor } from "bullmq";
import { pino } from "pino";
import type { Logger } from "pino";
import { ConfigError, loadWorkerConfig } from "../config.ts";
import { createValkey } from "../shared/valkey.ts";
import { DEFAULT_PREFIX } from "./queues.ts";
import { createSystemWorker } from "./system.ts";

const HEARTBEAT_EVERY_MS = 10_000;
const HEARTBEAT_TTL_S = 30;
const DEFAULT_SHUTDOWN_GRACE_MS = 25_000;
const DEFAULT_CONCURRENCY = 4;

export interface StartWorkerOptions {
  valkeyUrl: string;
  concurrency: number;
  /** Hard deadline for `close()`; keep it under Kubernetes' 30 s grace. Default 25000. */
  shutdownGraceMs?: number;
  /** BullMQ key prefix and heartbeat key prefix. Default "uroboros"; tests use their own. */
  prefix?: string;
  logger?: Logger;
  /** Test seams, passed through to `createSystemWorker`. */
  queueName?: string;
  processor?: Processor;
  stalledInterval?: number;
  lockDuration?: number;
  heartbeatEveryMs?: number;
}

export interface RunningWorker {
  /** Key of this process's heartbeat: `<prefix>:worker:<hostname>:<pid>`. */
  heartbeatKey: string;
  /**
   * Stops taking jobs and waits for active ones. If that takes longer than `shutdownGraceMs`, force
   * closes the worker and rejects, so the caller can exit non-zero instead of hanging.
   */
  close(): Promise<void>;
}

/** Starts the worker and its heartbeat. Installs no process handlers; the caller owns shutdown. */
export async function startWorker(opts: StartWorkerOptions): Promise<RunningWorker> {
  const log = opts.logger ?? pino({ name: "uroboros-worker" });
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  const graceMs = opts.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const heartbeatKey = `${prefix}:worker:${hostname()}:${String(process.pid)}`;
  const valkey = createValkey(opts.valkeyUrl, "worker", log);

  const beat = async () => {
    try {
      await valkey.set(heartbeatKey, new Date().toISOString(), "EX", HEARTBEAT_TTL_S);
    } catch (err) {
      log.warn({ err }, "heartbeat failed");
    }
  };

  const worker = createSystemWorker(valkey, {
    prefix,
    concurrency: opts.concurrency,
    ...(opts.queueName === undefined ? {} : { queueName: opts.queueName }),
    ...(opts.processor === undefined ? {} : { processor: opts.processor }),
    ...(opts.stalledInterval === undefined ? {} : { stalledInterval: opts.stalledInterval }),
    ...(opts.lockDuration === undefined ? {} : { lockDuration: opts.lockDuration }),
  });
  worker.on("error", (err) => {
    log.error({ err }, "worker error");
  });
  worker.on("failed", (job, err) => {
    log.error({ err, jobId: job?.id, job: job?.name }, "job failed");
  });

  await worker.waitUntilReady();
  await beat();
  const timer = setInterval(() => void beat(), opts.heartbeatEveryMs ?? HEARTBEAT_EVERY_MS);
  log.info({ heartbeatKey, concurrency: opts.concurrency }, "worker started");

  let closing: Promise<void> | undefined;
  const closeOnce = async () => {
    clearInterval(timer);
    let deadline: NodeJS.Timeout | undefined;
    const expired = new Promise<"timeout">((resolve) => {
      deadline = setTimeout(() => {
        resolve("timeout");
      }, graceMs);
    });
    try {
      const outcome = await Promise.race([worker.close().then(() => "closed" as const), expired]);
      if (outcome === "timeout") {
        // A graceful close() is already pending, so close(true) would just return it; cut both
        // connections (including the blocking one, which would otherwise keep the process alive).
        await worker.disconnect();
        throw new Error(`worker did not drain within ${String(graceMs)} ms; force closed`);
      }
      await valkey.del(heartbeatKey);
    } finally {
      clearTimeout(deadline);
      valkey.disconnect();
    }
  };
  return {
    heartbeatKey,
    close() {
      closing ??= closeOnce();
      return closing;
    },
  };
}

/**
 * Runs the worker until SIGTERM/SIGINT, then drains. Exit codes: 0 clean, 1 drain failed or hit the
 * deadline, 2 configuration error. Unlike the api it does not rely on the event loop emptying.
 */
export async function main(_argv: string[] = []): Promise<number> {
  const logger = pino({ name: "uroboros-worker" });
  let valkeyUrl: string;
  try {
    valkeyUrl = loadWorkerConfig(process.env).valkeyUrl;
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.fatal(err.message);
      return 2;
    }
    throw err;
  }
  const worker = await startWorker({ valkeyUrl, concurrency: DEFAULT_CONCURRENCY, logger });
  return new Promise<number>((resolve) => {
    let shuttingDown = false;
    const shutdown = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, "shutting down");
      worker.close().then(
        () => {
          resolve(0);
        },
        (err: unknown) => {
          logger.error({ err }, "shutdown failed");
          resolve(1);
        },
      );
    };
    process.once("SIGTERM", () => {
      shutdown("SIGTERM");
    });
    process.once("SIGINT", () => {
      shutdown("SIGINT");
    });
  });
}
