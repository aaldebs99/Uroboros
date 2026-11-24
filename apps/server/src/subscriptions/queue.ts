import type { Queue } from "bullmq";
import { repeatOf, type ScheduleRow } from "./schedule.ts";

/** Subscription checks (docs/automation.md). Each subscription has a job scheduler here. */
export const AUTOMATION_QUEUE = "automation";

/** Check one subscription now. */
export interface CheckJob {
  subscriptionId: string;
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

/** When the scheduler fires next, or null when there is none (paused). */
export async function nextCheckAt(q: Queue<CheckJob>, id: string): Promise<string | null> {
  const scheduler = await q.getJobScheduler(id);
  return scheduler?.next === undefined ? null : new Date(scheduler.next).toISOString();
}
