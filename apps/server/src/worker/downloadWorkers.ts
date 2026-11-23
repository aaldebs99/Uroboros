import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { cancelChannel } from "../downloads/events.ts";
import { DOWNLOAD_QUEUE, PROBE_QUEUE, type FetchJob, type ProbeJob } from "../downloads/queues.ts";
import type { WorkerDeps } from "./deps.ts";
import { createCancelRegistry, fetchProcessor } from "./fetch.ts";
import { probeProcessor } from "./probe.ts";

export interface DownloadWorkers {
  workers: Worker[];
  /** Stops listening for cancels (the workers are closed by the caller with the others). */
  close(): Promise<void>;
}

/**
 * The probe and download consumers on `connection` (which must allow blocking commands), and a
 * subscriber on its own connection that aborts a running fetch when the api asks.
 */
export async function startDownloadWorkers(
  connection: Redis,
  deps: WorkerDeps,
  opts: { prefix: string; concurrency: number },
): Promise<DownloadWorkers> {
  const cancels = createCancelRegistry();
  const subscriber = connection.duplicate();
  subscriber.on("message", (_channel, message) => {
    try {
      const { fetchKey } = JSON.parse(message) as { fetchKey?: unknown };
      if (typeof fetchKey === "string") cancels.cancel(fetchKey);
    } catch (err) {
      deps.logger.warn({ err }, "ignoring a malformed cancel message");
    }
  });
  await subscriber.subscribe(cancelChannel(opts.prefix));
  const probe = new Worker<ProbeJob>(PROBE_QUEUE, probeProcessor(deps), {
    connection,
    prefix: opts.prefix,
    concurrency: Math.max(4, opts.concurrency),
  });
  const download = new Worker<FetchJob>(DOWNLOAD_QUEUE, fetchProcessor(deps, cancels), {
    connection,
    prefix: opts.prefix,
    concurrency: opts.concurrency,
    // Long downloads: renew the lock often enough that a busy event loop never loses it.
    lockDuration: 60_000,
    maxStalledCount: 2,
  });
  for (const w of [probe, download]) {
    w.on("error", (err) => {
      deps.logger.error({ err, queue: w.name }, "worker error");
    });
  }
  return {
    workers: [probe, download],
    async close() {
      subscriber.disconnect();
      await Promise.resolve();
    },
  };
}
