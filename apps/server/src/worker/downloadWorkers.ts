import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import type { PgBus } from "../db/notifications.ts";
import { DOWNLOAD_QUEUE, type FetchJob } from "../downloads/queues.ts";
import { startJobWorker } from "../jobs/worker.ts";
import type { Consumer, JobWorker } from "../jobs/worker.ts";
import { notifyProcessor } from "./notify.ts";
import { startAutomationWorkers } from "./automationWorkers.ts";
import type { WorkerDeps } from "./deps.ts";
import { createCancelRegistry, fetchProcessor } from "./fetch.ts";
import { probeProcessor } from "./probe.ts";
import { selfTest } from "../transcode/hwaccel.ts";

/** Pushes sent at once per replica. */
const NOTIFY_CONCURRENCY = 4;

export interface DownloadWorkers {
  workers: Worker[];
  /** The consumers of the queues on Postgres (docs/jobs.md). */
  jobs: JobWorker;
  /** Aborts every running fetch for shutdown; each goes back to the queue unrecorded. */
  abortRunning(): void;
  /** Stops listening for cancels (the workers are closed by the caller with the others). */
  close(): Promise<void>;
}

/**
 * The probe, download, automation and notify consumers on `connection` (which must allow blocking
 * commands), and a listener on the bus's cancel channel that aborts a running fetch when the api
 * asks.
 */
export async function startDownloadWorkers(
  connection: Redis,
  deps: WorkerDeps,
  opts: { prefix: string; concurrency: number; bus: PgBus },
): Promise<DownloadWorkers> {
  const cancels = createCancelRegistry();
  const offCancels = opts.bus.on("uroboros_cancel", (message) => {
    try {
      const { fetchKey } = JSON.parse(message) as { fetchKey?: unknown };
      if (typeof fetchKey === "string") cancels.cancel(fetchKey);
    } catch (err) {
      deps.logger.warn({ err }, "ignoring a malformed cancel message");
    }
  });
  const download = new Worker<FetchJob>(DOWNLOAD_QUEUE, fetchProcessor(deps, cancels), {
    connection,
    prefix: opts.prefix,
    concurrency: opts.concurrency,
    // Long downloads: renew the lock often enough that a busy event loop never loses it.
    lockDuration: 60_000,
    maxStalledCount: 2,
  });
  for (const w of [download]) {
    w.on("error", (err) => {
      deps.logger.error({ err, queue: w.name }, "worker error");
    });
  }
  // A replica that runs playback sessions tries its GPU once; a broken one sends runs to the CPU.
  if (deps.transcodeConcurrency > 0) {
    deps.transcoder.gpuWorks = await selfTest({
      hwaccel: deps.transcoder.hwaccel,
      vaapiDevice: deps.transcoder.vaapiDevice,
      ffmpeg: deps.transcoder.ffmpeg.binary,
      ...(deps.transcoder.ffmpeg.env === undefined ? {} : { env: deps.transcoder.ffmpeg.env }),
      logger: deps.logger,
    });
  }
  const automation = startAutomationWorkers(connection, deps, { prefix: opts.prefix });
  const consumers: Consumer[] = [
    {
      queue: "probe",
      concurrency: Math.max(4, opts.concurrency),
      process: probeProcessor(deps) as Consumer["process"],
    },
    {
      queue: "notify",
      concurrency: NOTIFY_CONCURRENCY,
      process: notifyProcessor(deps.push, deps.logger) as Consumer["process"],
    },
  ];
  const jobs = startJobWorker({ db: deps.db, bus: opts.bus, logger: deps.logger, consumers });
  return {
    workers: [download, ...automation.workers],
    jobs,
    abortRunning() {
      cancels.abortAll();
      automation.abortRunning();
    },
    async close() {
      offCancels();
      await Promise.resolve();
    },
  };
}
