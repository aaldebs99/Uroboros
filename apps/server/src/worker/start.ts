import { hostname } from "node:os";
import type { Processor } from "bullmq";
import { pino } from "pino";
import type { Logger } from "pino";
import type { Redis } from "ioredis";
import type { DownloadWorkers } from "./downloadWorkers.ts";
import { createValkey } from "../shared/valkey.ts";
import { DEFAULT_PREFIX } from "./queues.ts";
import { createSystemWorker } from "./system.ts";

const HEARTBEAT_EVERY_MS = 10_000;
const HEARTBEAT_TTL_S = 30;
/** How long a stopping process waits for its running jobs. */
export const DEFAULT_SHUTDOWN_GRACE_MS = 25_000;
/** Before the grace runs out, running fetches are cut and requeued, so the drain can finish. */
const ABORT_MARGIN_MS = 5000;

export interface StartWorkerOptions {
  valkeyUrl: string;
  concurrency: number;
  /** Hard deadline for `close()`; keep it under the container's stop timeout. Default 25000. */
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
  /** More consumers to start on the worker's connection once it is ready (the download queues). */
  extraWorkers?: (connection: Redis) => Promise<DownloadWorkers>;
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
  const log = opts.logger ?? pino({ name: "uroboros" });
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
  const extra = opts.extraWorkers === undefined ? null : await opts.extraWorkers(valkey);
  const timer = setInterval(() => void beat(), opts.heartbeatEveryMs ?? HEARTBEAT_EVERY_MS);
  log.info({ heartbeatKey, concurrency: opts.concurrency }, "job consumers started");

  let closing: Promise<void> | undefined;
  const closeOnce = async () => {
    clearInterval(timer);
    // Short jobs finish on their own; a long download is cut near the deadline and requeued.
    const cut = setTimeout(
      () => {
        extra?.abortRunning();
      },
      Math.max(0, graceMs - ABORT_MARGIN_MS),
    );
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
        await Promise.all([worker.close(), ...(extra?.workers ?? []).map((w) => w.close())]);
        await extra?.close();
        await bestEffort(valkey.del(heartbeatKey), 1000);
      })();
      drain.catch(() => undefined); // may settle after the deadline; the race reports the outcome
      const outcome = await Promise.race([drain.then(() => "closed" as const), expired]);
      if (outcome === "timeout") {
        // The pending graceful close() cannot be forced, so cut the connections (including the
        // blocking one) without awaiting. BullMQ's lock renewal timer keeps running after this, so
        // the process cannot exit by draining; bin/server.ts calls process.exit.
        worker.disconnect().catch(() => undefined);
        for (const w of extra?.workers ?? []) w.disconnect().catch(() => undefined);
        throw new Error(`worker did not drain within ${String(graceMs)} ms; force closed`);
      }
    } finally {
      clearTimeout(cut);
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
