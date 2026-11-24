import type { Queue } from "bullmq";
import { repeatOf, type ScheduleRow } from "./schedule.ts";

/** Subscription checks (docs/automation.md). Each subscription has a job scheduler here. */
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

/**
 * Makes the subscription's schedule match it: a job scheduler firing every `interval_minutes`, or
 * on its cron in its timezone, while enabled (BullMQ fires each schedule once across replicas, and
 * runs a new interval's first job at once), none while paused.
 */
export async function scheduleCheck(
  q: Queue<CheckJob>,
  s: ScheduleRow & { id: string; enabled: boolean },
): Promise<void> {
  if (!s.enabled) {
    await q.removeJobScheduler(s.id);
    return;
  }
  await q.upsertJobScheduler(s.id, repeatOf(s), {
    name: "check",
    data: { subscriptionId: s.id },
    opts: JOB_OPTS,
  });
}

export async function unscheduleCheck(q: Queue<CheckJob>, id: string): Promise<void> {
  await q.removeJobScheduler(id);
}

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

/** When the scheduler fires next, or null when there is none (paused). */
export async function nextCheckAt(q: Queue<CheckJob>, id: string): Promise<string | null> {
  const scheduler = await q.getJobScheduler(id);
  return scheduler?.next === undefined ? null : new Date(scheduler.next).toISOString();
}
