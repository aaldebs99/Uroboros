import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { NOTIFY_QUEUE, type NotifyJob } from "../downloads/queues.ts";
import { checkProcessor } from "../subscriptions/check.ts";
import { latestProcessor } from "../subscriptions/latest.ts";
import { AUTOMATION_QUEUE, type CheckJob } from "../subscriptions/queue.ts";
import { PLAYBACK_QUEUE, type PlaybackJob } from "../transcode/sessionQueue.ts";
import type { WorkerDeps } from "./deps.ts";
import { notifyProcessor } from "./notify.ts";
import { sessionProcessor } from "./session.ts";

/** Checks at once per replica; few, so a burst of schedules never hammers a site. */
export const CHECK_CONCURRENCY = 2;
/** Across every replica, at most one check starts per this many ms (BullMQ's queue-wide limiter). */
export const CHECK_START_EVERY_MS = 2000;
const NOTIFY_CONCURRENCY = 4;

export interface AutomationWorkers {
  workers: Worker[];
  /** Stops running checks for shutdown; each records nothing and runs again on schedule. */
  abortRunning(): void;
}

/** The `automation` (subscription checks), `notify` and `playback` consumers on `connection`. */
export function startAutomationWorkers(
  connection: Redis,
  deps: WorkerDeps,
  opts: { prefix: string },
): AutomationWorkers {
  const stop = new AbortController();
  const checks = checkProcessor(deps, stop.signal);
  const latest = latestProcessor(deps);
  // One queue, two kinds of job: a check (scheduled or now), or a "download the latest N".
  const automation = (job: { name: string; data: CheckJob }) =>
    job.name === "latest" ? latest(job) : checks(job);
  const check = new Worker<CheckJob>(AUTOMATION_QUEUE, automation, {
    connection,
    prefix: opts.prefix,
    concurrency: CHECK_CONCURRENCY,
    limiter: { max: 1, duration: CHECK_START_EVERY_MS },
  });
  const notify = new Worker<NotifyJob>(NOTIFY_QUEUE, notifyProcessor(deps.push, deps.logger), {
    connection,
    prefix: opts.prefix,
    concurrency: NOTIFY_CONCURRENCY,
  });
  // Playback sessions: none on a replica told to take none (so only GPU replicas need to).
  const playback =
    deps.transcodeConcurrency > 0
      ? [
          new Worker<PlaybackJob>(PLAYBACK_QUEUE, sessionProcessor(deps, stop.signal), {
            connection,
            prefix: opts.prefix,
            concurrency: deps.transcodeConcurrency,
            // A session's job lives as long as its viewer: renew the lock often enough that a busy
            // event loop never loses it.
            lockDuration: 60_000,
          }),
        ]
      : [];
  for (const w of [check, notify, ...playback]) {
    w.on("error", (err) => {
      deps.logger.error({ err, queue: w.name }, "worker error");
    });
  }
  return {
    workers: [check, notify, ...playback],
    abortRunning() {
      stop.abort();
    },
  };
}
