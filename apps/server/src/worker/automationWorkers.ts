import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { NOTIFY_QUEUE, type NotifyJob } from "../downloads/queues.ts";
import { checkProcessor } from "../subscriptions/check.ts";
import { AUTOMATION_QUEUE, type CheckJob } from "../subscriptions/queue.ts";
import type { WorkerDeps } from "./deps.ts";
import { notifyProcessor } from "./notify.ts";

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

/** The `automation` (subscription checks) and `notify` consumers on `connection`. */
export function startAutomationWorkers(
  connection: Redis,
  deps: WorkerDeps,
  opts: { prefix: string },
): AutomationWorkers {
  const stop = new AbortController();
  const check = new Worker<CheckJob>(AUTOMATION_QUEUE, checkProcessor(deps, stop.signal), {
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
  for (const w of [check, notify]) {
    w.on("error", (err) => {
      deps.logger.error({ err, queue: w.name }, "worker error");
    });
  }
  return {
    workers: [check, notify],
    abortRunning() {
      stop.abort();
    },
  };
}
