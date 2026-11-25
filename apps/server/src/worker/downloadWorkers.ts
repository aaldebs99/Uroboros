import type { PgBus } from "../db/notifications.ts";
import { startJobWorker } from "../jobs/worker.ts";
import type { Consumer, JobWorker } from "../jobs/worker.ts";
import { selfTest } from "../transcode/hwaccel.ts";
import { automationConsumers } from "./automationWorkers.ts";
import type { WorkerDeps } from "./deps.ts";
import { createCancelRegistry, fetchProcessor } from "./fetch.ts";
import { notifyProcessor } from "./notify.ts";
import { probeProcessor } from "./probe.ts";
import { uploadProcessor } from "../uploads/process.ts";
import { exportProcessor } from "./exportRun.ts";
import { previewProcessor } from "./previewRun.ts";
import { refetchSkipsProcessor } from "./refetchSkips.ts";
import { subtitlesProcessor } from "./subtitlesJob.ts";
import type { ProbeJob, SkipsJob, SubtitlesJob } from "../downloads/queues.ts";

/** Pushes sent at once per replica. */
const NOTIFY_CONCURRENCY = 4;
/** Uploads filed at once per replica (docs/uploads.md): each mostly waits on ffprobe. */
const UPLOAD_CONCURRENCY = 2;
/** Copies without sponsors re-encoded at once per transcoding replica: each takes a whole encoder. */
const EXPORT_CONCURRENCY = 1;
/** Hover previews cut at once per transcoding replica (docs/library.md): small, on the CPU. */
const PREVIEW_CONCURRENCY = 1;

export interface DownloadWorkers {
  /** The consumers of every queue (docs/jobs.md). */
  jobs: JobWorker;
  /** Cuts every running fetch, upload, copy and playback run for shutdown; each goes back to its queue. */
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
  const uploads = uploadProcessor(deps);
  const exports = exportProcessor(deps);
  const previews = previewProcessor(deps);
  const probes = probeProcessor(deps);
  const skips = refetchSkipsProcessor(deps);
  const subtitles = subtitlesProcessor(deps);
  // One queue, three kinds of job: a pasted link's probe, a SponsorBlock refetch (`skips`), or the
  // subtitles a rate limit held back (`subtitles`).
  const probeQueue = (job: { name: string; data: ProbeJob | SkipsJob | SubtitlesJob }) => {
    if (job.name === "skips") return skips(job as { data: SkipsJob });
    if (job.name === "subtitles") return subtitles(job as { data: SubtitlesJob });
    return probes(job as { data: ProbeJob });
  };
  const consumers: Consumer[] = [
    {
      queue: "probe",
      concurrency: Math.max(4, opts.concurrency),
      process: probeQueue as Consumer["process"],
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
    {
      queue: "upload",
      concurrency: UPLOAD_CONCURRENCY,
      process: uploads.process as Consumer["process"],
    },
    ...automation.consumers,
    // Copies and previews are made where playback sessions are: replicas with a transcoder to spare.
    ...(deps.transcodeConcurrency > 0
      ? [
          {
            queue: "export" as const,
            concurrency: EXPORT_CONCURRENCY,
            process: exports.process as Consumer["process"],
          },
          {
            queue: "preview" as const,
            concurrency: PREVIEW_CONCURRENCY,
            process: previews.process as Consumer["process"],
          },
        ]
      : []),
  ];
  const jobs = startJobWorker({ db: deps.db, bus: opts.bus, logger: deps.logger, consumers });
  return {
    jobs,
    abortRunning() {
      cancels.abortAll();
      uploads.abortAll();
      exports.abortAll();
      previews.abortAll();
      automation.abortRunning();
    },
    close() {
      offCancels();
      return Promise.resolve();
    },
  };
}
