import type { PgBus } from "../db/notifications.ts";
import { startJobWorker } from "../jobs/worker.ts";
import type { Consumer, JobWorker } from "../jobs/worker.ts";
import { selfTest } from "../transcode/hwaccel.ts";
import { automationConsumers } from "./automationWorkers.ts";
import type { WorkerDeps } from "./deps.ts";
import { createCancelRegistry, fetchProcessor } from "./fetch.ts";
import { notifyProcessor } from "./notify.ts";
import { probeProcessor } from "./probe.ts";

/** Pushes sent at once per replica. */
const NOTIFY_CONCURRENCY = 4;

export interface DownloadWorkers {
  /** The consumers of every queue (docs/jobs.md). */
  jobs: JobWorker;
  /** Cuts every running fetch and playback run for shutdown; each goes back to its queue. */
  abortRunning(): void;
  /** Stops listening for cancels (the job worker is drained by the caller first). */
  close(): Promise<void>;
}

/**
 * Every consumer of the replica on one job worker (docs/jobs.md), and a listener on the bus's
 * cancel channel that aborts a running fetch when the api asks.
 */
export async function startDownloadWorkers(
  deps: WorkerDeps,
  opts: { concurrency: number; bus: PgBus },
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
  const automation = automationConsumers(deps);
  const consumers: Consumer[] = [
    {
      queue: "probe",
      concurrency: Math.max(4, opts.concurrency),
      process: probeProcessor(deps) as Consumer["process"],
    },
    {
      queue: "download",
      concurrency: opts.concurrency,
      process: fetchProcessor(deps, cancels) as Consumer["process"],
    },
    {
      queue: "notify",
      concurrency: NOTIFY_CONCURRENCY,
      process: notifyProcessor(deps.push, deps.logger) as Consumer["process"],
    },
    ...automation.consumers,
  ];
  const jobs = startJobWorker({ db: deps.db, bus: opts.bus, logger: deps.logger, consumers });
  return {
    jobs,
    abortRunning() {
      cancels.abortAll();
      automation.abortRunning();
    },
    close() {
      offCancels();
      return Promise.resolve();
    },
  };
}
