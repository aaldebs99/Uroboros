import type { Queue } from "bullmq";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { periodicDuty } from "../shared/periodic.ts";
import { reapOnce, REAPER_EVERY_MS } from "../storage/reaper.ts";
import type { MediaStore } from "../storage/store.ts";
import { reconcileTranscodes, TRANSCODE_RECONCILE_EVERY_MS } from "../transcode/reconcile.ts";
import { scheduleCheck, type CheckJob } from "./queue.ts";
import { applyRetention, RETENTION_EVERY_MS } from "./retention.ts";

export const RESYNC_EVERY_MS = 300_000;

/**
 * Makes the job schedulers match the table: every enabled subscription of an active owner has one
 * at its interval, and no other scheduler exists. Heals a flushed Valkey, or a crash between a
 * database commit and the scheduler call.
 */
export async function resyncSchedulers(
  db: Kysely<Database>,
  q: Queue<CheckJob>,
): Promise<{ added: number; removed: number }> {
  const wanted = await db
    .selectFrom("subscriptions as s")
    .innerJoin("users as u", "u.id", "s.user_id")
    .select(["s.id", "s.interval_minutes"])
    .where("s.enabled", "=", true)
    .where("u.disabled_at", "is", null)
    .where("u.revoked_at", "is", null)
    .execute();
  const schedulers = await q.getJobSchedulers(0, -1);
  const every = new Map(schedulers.map((s) => [s.key, s.every]));
  let added = 0;
  for (const s of wanted) {
    if (every.get(s.id) === s.interval_minutes * 60_000) continue;
    await scheduleCheck(q, { ...s, enabled: true });
    added++;
  }
  const keep = new Set(wanted.map((s) => s.id));
  let removed = 0;
  for (const s of schedulers) {
    if (keep.has(s.key)) continue;
    await q.removeJobScheduler(s.key);
    removed++;
  }
  return { added, removed };
}

/**
 * The leader's automation duties: keep schedules in step, apply retention hourly, run the reaper
 * every 15 minutes (with unused playback copies older than `keepDays`), and re-add lost transcode
 * jobs every minute.
 */
export function automationDuties(
  ctx: DownloadContext,
  store: MediaStore,
  opts: { keepDays: number } = { keepDays: 30 },
) {
  const resync = periodicDuty(
    "scheduler re-sync",
    RESYNC_EVERY_MS,
    () => resyncSchedulers(ctx.db, ctx.queues.automation),
    ctx.logger,
  );
  const retention = periodicDuty(
    "retention",
    RETENTION_EVERY_MS,
    async () => {
      const removed = await applyRetention(ctx.db);
      if (removed > 0) ctx.logger.info({ removed }, "retention removed library entries");
    },
    ctx.logger,
  );
  const reaper = periodicDuty(
    "reaper",
    REAPER_EVERY_MS,
    () => reapOnce(ctx.db, store, ctx.logger, undefined, opts.keepDays),
    ctx.logger,
  );
  const transcodes = periodicDuty(
    "transcode reconcile",
    TRANSCODE_RECONCILE_EVERY_MS,
    () => reconcileTranscodes(ctx),
    ctx.logger,
  );
  return async (signal: AbortSignal): Promise<void> => {
    await Promise.all([resync(signal), retention(signal), reaper(signal), transcodes(signal)]);
  };
}
