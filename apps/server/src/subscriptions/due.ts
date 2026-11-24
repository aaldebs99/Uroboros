/**
 * Scheduled checks (docs/automation.md), a leader duty ported from Djinn's scheduler: every few
 * seconds the leader looks for subscriptions whose next check is due, and claims each with a
 * conditional update that moves its next check on, so a pass that raced another (a new leader
 * while the old one finishes) queues nothing twice. Missed runs are skipped, never replayed.
 */
import { sql } from "kysely";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { checkNow } from "./queue.ts";
import { nextCheckAfter } from "./schedule.ts";

/** How often the leader looks for due checks. */
export const DUE_EVERY_MS = 5000;
/** Checks queued per pass at most; the rest wait for the next pass. */
const BATCH = 100;

interface DueRow {
  now: Date;
  id: string;
  /** next_check_at as Postgres prints it: compared as text, since a JS Date drops microseconds. */
  expected: string;
  due: Date;
  interval_minutes: number | null;
  cron: string | null;
  cron_tz: string | null;
}

/** Queues every due check of an enabled subscription with an active owner; returns how many. */
export async function checkDueSubscriptions(ctx: DownloadContext): Promise<number> {
  const due = await sql<DueRow>`
    SELECT now() AS now, s.id, s.next_check_at::text AS expected, s.next_check_at AS due,
      s.interval_minutes, s.cron, s.cron_tz
    FROM subscriptions s JOIN users u ON u.id = s.user_id
    WHERE s.enabled AND s.next_check_at <= now() AND u.disabled_at IS NULL AND u.revoked_at IS NULL
    ORDER BY s.next_check_at LIMIT ${BATCH}`.execute(ctx.db);
  let queued = 0;
  for (const row of due.rows) {
    const claimed = await ctx.db
      .updateTable("subscriptions")
      .set({ next_check_at: nextCheckAfter(row, row.due, row.now) })
      .where("id", "=", row.id)
      .where("enabled", "=", true)
      .where(sql<boolean>`next_check_at = ${row.expected}::timestamptz`)
      .executeTakeFirst();
    if (claimed.numUpdatedRows === 0n) continue;
    await checkNow(ctx.queues.automation, row.id);
    queued++;
  }
  return queued;
}
