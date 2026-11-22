import { hostname } from "node:os";
import type { Processor } from "bullmq";
import { pino } from "pino";
import type { Logger } from "pino";
import { ConfigError, loadWorkerConfig } from "../config.ts";
import { createValkey } from "../shared/valkey.ts";
import { DEFAULT_PREFIX } from "./queues.ts";
import { createSystemWorker } from "./system.ts";
import { logToolVersions } from "./versions.ts";

const HEARTBEAT_EVERY_MS = 10_000;
const HEARTBEAT_TTL_S = 30;
const DEFAULT_SHUTDOWN_GRACE_MS = 25_000;

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
  /**
   * Aborts a startup that has not reached ready (Valkey unreachable makes it wait forever): the
   * worker is closed within `shutdownGraceMs` and `startWorker` rejects with `StartupAborted`.
   */
  abort?: AbortSignal;
}

/** `startWorker` was aborted before the worker was ready. */
export class StartupAborted extends Error {
  constructor() {
    super("worker startup aborted before it was ready");
    this.name = "StartupAborted";
  }
}

/** Resolves true if `signal` aborts before `p` settles, false once `p` resolves; rejects with `p`. */
function abortedFirst(p: Promise<unknown>, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(true);
  return new Promise<boolean>((resolve, reject) => {
    const onAbort = () => {
      resolve(true);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve(false);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
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

/** Awaits `p` for at most `ms`, swallowing its failure and its timeout. */
async function bestEffort(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      p.catch(() => undefined),
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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

  const ready = (async () => {
    await worker.waitUntilReady();
    await beat();
  })();
  ready.catch(() => undefined); // may settle after an abort; the race below reports the outcome
  if (opts.abort !== undefined && (await abortedFirst(ready, opts.abort))) {
    // Nothing can be active before ready, so there is nothing to drain: close what exists, bounded
    // by the grace period, then cut the connections so no retry loop outlives this call.
    await bestEffort(worker.close(true), graceMs);
    worker.disconnect().catch(() => undefined);
    valkey.disconnect();
    throw new StartupAborted();
  }
  await ready;
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
      // The whole sequence, not just worker.close(), is bounded by the deadline: with Valkey
      // unreachable, every awaited call here can hang.
      const drain = (async () => {
        await worker.close();
        await bestEffort(valkey.del(heartbeatKey), 1000);
      })();
      drain.catch(() => undefined); // may settle after the deadline; the race reports the outcome
      const outcome = await Promise.race([drain.then(() => "closed" as const), expired]);
      if (outcome === "timeout") {
        // The pending graceful close() cannot be forced, so cut the connections (including the
        // blocking one) without awaiting. BullMQ's lock renewal timer keeps running after this, so
        // the process cannot exit by draining; bin/worker.ts calls process.exit.
        worker.disconnect().catch(() => undefined);
        throw new Error(`worker did not drain within ${String(graceMs)} ms; force closed`);
      }
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

function parseGraceMs(text: string): number {
  if (!/^[1-9]\d*$/.test(text)) {
    throw new ConfigError(
      `UROBOROS_WORKER_TEST_GRACE_MS must be a positive integer, got "${text}"`,
    );
  }
  return Number(text);
}

/**
 * Env seam for the spawned-process test, honoured only when UROBOROS_WORKER_TEST_QUEUE is set:
 * UROBOROS_WORKER_TEST_{QUEUE,PREFIX,GRACE_MS} and UROBOROS_WORKER_TEST_HANG=1 (processor that never
 * finishes). Never set in production.
 */
function testOverridesFromEnv(env: NodeJS.ProcessEnv): Partial<StartWorkerOptions> {
  const queueName = env["UROBOROS_WORKER_TEST_QUEUE"];
  if (queueName === undefined) return {};
  const prefix = env["UROBOROS_WORKER_TEST_PREFIX"];
  const grace = env["UROBOROS_WORKER_TEST_GRACE_MS"];
  return {
    queueName,
    ...(prefix === undefined ? {} : { prefix }),
    ...(grace === undefined ? {} : { shutdownGraceMs: parseGraceMs(grace) }),
    ...(env["UROBOROS_WORKER_TEST_HANG"] === "1"
      ? { processor: () => new Promise<never>(() => undefined) }
      : {}),
  };
}

/**
 * Runs the worker until SIGTERM/SIGINT, then drains. Exit codes: 0 clean, 1 drain failed, hit the
 * deadline or a signal arrived before the worker was ready, 2 configuration error. After a missed deadline BullMQ's lock renewal timer is still
 * alive, so the process does not exit by itself; bin/worker.ts calls process.exit with this code.
 * `overrides` is a test seam (prefix, queue, processor, grace) and wins over the env seam.
 */
export async function main(
  _argv: string[] = [],
  overrides: Partial<StartWorkerOptions> = {},
): Promise<number> {
  const logger = pino({ name: "uroboros-worker" });
  let valkeyUrl: string;
  let concurrency: number;
  let ytdlpPath: string;
  let testOverrides: Partial<StartWorkerOptions>;
  try {
    ({ valkeyUrl, concurrency, ytdlpPath } = loadWorkerConfig(process.env));
    testOverrides = testOverridesFromEnv(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.fatal(err.message);
      return 2;
    }
    throw err;
  }
  await logToolVersions(logger, { ytdlp: ytdlpPath });
  // Trapped before the worker starts: BullMQ begins taking jobs inside startWorker, so a SIGTERM
  // that lands before it returns must still drain them, not kill the process mid-job. A signal
  // before the worker is ready (Valkey unreachable) aborts the startup instead, and main returns 1
  // within the grace period rather than waiting for a connection that may never come.
  const signals = trapShutdownSignals();
  const startup = new AbortController();
  void signals.received.then((signal) => {
    startup.abort(signal);
  });
  try {
    let worker: RunningWorker;
    try {
      worker = await startWorker({
        valkeyUrl,
        concurrency,
        logger,
        ...testOverrides,
        ...overrides,
        abort: startup.signal,
      });
    } catch (err) {
      if (!(err instanceof StartupAborted)) throw err;
      logger.error(
        { signal: startup.signal.reason as unknown },
        "shut down before the worker was ready",
      );
      return 1;
    }
    const signal = await signals.received;
    logger.info({ signal }, "shutting down");
    try {
      await worker.close();
      return 0;
    } catch (err) {
      logger.error({ err }, "shutdown failed");
      return 1;
    }
  } finally {
    signals.dispose();
  }
}

/** The first SIGTERM or SIGINT, from the moment this is called; `dispose` removes the listeners. */
function trapShutdownSignals(): { received: Promise<string>; dispose(): void } {
  let onSignal: (signal: string) => void = () => undefined;
  const received = new Promise<string>((resolve) => {
    onSignal = resolve;
  });
  const onTerm = () => {
    onSignal("SIGTERM");
  };
  const onInt = () => {
    onSignal("SIGINT");
  };
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onInt);
  return {
    received,
    dispose() {
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
    },
  };
}
