import type { Consumer } from "../jobs/worker.ts";
import { checkProcessor } from "../subscriptions/check.ts";
import { latestProcessor } from "../subscriptions/latest.ts";
import type { CheckJob } from "../subscriptions/queue.ts";
import type { WorkerDeps } from "./deps.ts";
import { sessionProcessor } from "./session.ts";

/** Checks at once per replica; few, so a burst of due checks never hammers a site. */
export const CHECK_CONCURRENCY = 2;

export interface AutomationConsumers {
  consumers: Consumer[];
  /** Stops running checks and playback runs for shutdown (checks record nothing; runs requeue). */
  abortRunning(): void;
}

/**
 * The `automation` (subscription checks, at most one starting every 2 s across replicas) and
 * `playback` consumers; none of the latter on a replica told to take none, so only GPU replicas
 * need to.
 */
export function automationConsumers(deps: WorkerDeps): AutomationConsumers {
  const stop = new AbortController();
  const checks = checkProcessor(deps, stop.signal);
  const latest = latestProcessor(deps);
  // One queue, two kinds of job: a check (scheduled or now), or a "download the latest N".
  const automation = (job: { name: string; data: CheckJob }) =>
    job.name === "latest" ? latest(job) : checks(job);
  const consumers: Consumer[] = [
    {
      queue: "automation",
      concurrency: CHECK_CONCURRENCY,
      process: automation as Consumer["process"],
    },
  ];
  if (deps.transcodeConcurrency > 0) {
    consumers.push({
      queue: "playback",
      concurrency: deps.transcodeConcurrency,
      process: sessionProcessor(deps, stop.signal) as Consumer["process"],
    });
  }
  return {
    consumers,
    abortRunning() {
      stop.abort();
    },
  };
}
