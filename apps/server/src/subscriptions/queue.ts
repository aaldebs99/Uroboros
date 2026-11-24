import type { Queue } from "bullmq";

/**
 * Subscription checks (docs/automation.md): the leader queues one when a subscription's next check
 * comes round (`due.ts`), and people can ask for one now.
 */
export const AUTOMATION_QUEUE = "automation";

/**
 * A job on the queue: a `check` of one subscription (scheduled or now), or a `latest` that
 * downloads its newest `count` videos (`latest.ts`).
 */
export interface CheckJob {
  subscriptionId: string;
  /** A `latest` job: how many of each feed's newest to download. */
  count?: number;
}

const JOB_OPTS = { removeOnComplete: true, removeOnFail: true } as const;

/** A one-off check; a second while one waits is the same job (`check|<id>`). */
export async function checkNow(q: Queue<CheckJob>, id: string): Promise<void> {
  await q.add("check", { subscriptionId: id }, { jobId: `check|${id}`, ...JOB_OPTS });
}

/** How long a `latest` waits for a running check to let go of the subscription, between tries. */
const LATEST_RETRY_MS = 30_000;

/**
 * Downloads the subscription's latest `count` videos, in a job: yt-dlp lists them, and only job
 * consumers run it. One waiting already (`latest|<id>`) absorbs another; while a check holds the
 * subscription it tries again every 30 s, for a while.
 */
export async function queueLatest(q: Queue<CheckJob>, id: string, count: number): Promise<void> {
  await q.add(
    "latest",
    { subscriptionId: id, count },
    {
      jobId: `latest|${id}`,
      attempts: 20,
      backoff: { type: "fixed", delay: LATEST_RETRY_MS },
      ...JOB_OPTS,
    },
  );
}
