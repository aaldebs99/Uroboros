import type { CheckSchedule } from "@uroboros/contract";
import { CronExpressionParser } from "cron-parser";
import { ApiError } from "../api/errors.ts";

/**
 * A subscription's check schedule (docs/automation.md): every N minutes, or a standard 5-field
 * cron in an IANA timezone. Both are held to the deployment's shortest interval
 * (`UROBOROS_MIN_CHECK_INTERVAL_MINUTES`), a cron by the gap between its next runs.
 */

/** Enough runs to catch a cron that bunches up somewhere in its day ("0,1 9 * * *"). */
const RUNS_CHECKED = 200;

/** Whether `tz` is a timezone this Node knows (`Intl`'s IANA names, "UTC" included). */
function knownTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function minutesText(minutes: number): string {
  return minutes === 1 ? "1 minute" : `${String(minutes)} minutes`;
}

/** The shortest gap, in minutes, between a cron's next runs. */
function shortestGap(expression: string, tz: string): number {
  const runs = CronExpressionParser.parse(expression, { tz, currentDate: new Date() });
  let previous = runs.next().getTime();
  let shortest = Number.POSITIVE_INFINITY;
  for (let i = 1; i < RUNS_CHECKED && runs.hasNext(); i++) {
    const at = runs.next().getTime();
    shortest = Math.min(shortest, (at - previous) / 60_000);
    previous = at;
  }
  return shortest;
}

function checkCron(expression: string, tz: string, min: number): void {
  if (expression.split(/\s+/).length !== 5) {
    throw new ApiError(
      "bad_request",
      "a cron schedule has 5 fields: minute, hour, day of month, month, day of week",
    );
  }
  if (!knownTimezone(tz)) throw new ApiError("bad_request", `unknown timezone: ${tz}`);
  let gap: number;
  try {
    gap = shortestGap(expression, tz);
  } catch {
    throw new ApiError("bad_request", `not a valid cron schedule: ${expression}`);
  }
  if (gap < min) {
    throw new ApiError(
      "bad_request",
      `that schedule runs every ${minutesText(Math.round(gap))}; the shortest allowed is ${minutesText(min)}`,
    );
  }
}

/** Refuses a schedule that runs more often than `min` minutes, or a cron that doesn't parse. */
export function checkSchedule(schedule: CheckSchedule, min: number): void {
  if (schedule.kind === "interval") {
    if (schedule.minutes < min) {
      throw new ApiError("bad_request", `checks run at most every ${minutesText(min)}`);
    }
    return;
  }
  checkCron(schedule.expression.trim(), schedule.timezone, min);
}

/** The columns a schedule is stored in: one kind set, the other null. */
export function scheduleColumns(schedule: CheckSchedule): {
  interval_minutes: number | null;
  cron: string | null;
  cron_tz: string | null;
} {
  return schedule.kind === "interval"
    ? { interval_minutes: schedule.minutes, cron: null, cron_tz: null }
    : {
        interval_minutes: null,
        cron: schedule.expression.trim().replace(/\s+/g, " "),
        cron_tz: schedule.timezone,
      };
}

export interface ScheduleRow {
  interval_minutes: number | null;
  cron: string | null;
  cron_tz: string | null;
}

/** The stored schedule as the contract has it. */
export function scheduleOf(row: ScheduleRow): CheckSchedule {
  if (row.cron !== null) {
    return { kind: "cron", expression: row.cron, timezone: row.cron_tz ?? "UTC" };
  }
  return { kind: "interval", minutes: row.interval_minutes ?? 0 };
}

/** The next tick of the row's cron after `after`, in its timezone. */
function nextCronTick(row: ScheduleRow, after: Date): Date {
  return CronExpressionParser.parse(row.cron ?? "", {
    tz: row.cron_tz ?? "UTC",
    currentDate: after,
  })
    .next()
    .toDate();
}

/**
 * When a schedule's first check is due, as it is created, changed or resumed: an interval counts
 * from the last check (a new one checks at once), never earlier than now; a cron waits for its
 * next tick.
 */
export function firstCheckAt(row: ScheduleRow, lastCheckedAt: Date | null, now: Date): Date {
  if (row.cron !== null) return nextCronTick(row, now);
  if (lastCheckedAt === null) return now;
  const due = lastCheckedAt.getTime() + (row.interval_minutes ?? 0) * 60_000;
  return new Date(Math.max(now.getTime(), due));
}

/**
 * When the check after one due at `due` is: the interval's next step after now, counted from the
 * due time so the schedule keeps its rhythm, skipping steps missed meanwhile (Djinn's `next_after`);
 * or the cron's next tick.
 */
export function nextCheckAfter(row: ScheduleRow, due: Date, now: Date): Date {
  if (row.cron !== null) return nextCronTick(row, now);
  const step = Math.max(1, row.interval_minutes ?? 0) * 60_000;
  const steps = Math.floor((now.getTime() - due.getTime()) / step) + 1;
  return new Date(due.getTime() + Math.max(1, steps) * step);
}
