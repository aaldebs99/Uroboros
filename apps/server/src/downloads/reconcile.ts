import { sql } from "kysely";
import { addFetchJob, dispatchFor, type DownloadContext } from "./dispatch.ts";
import { publishDownloadEvents } from "./events.ts";

/** A download dispatched this recently is left alone (its fetch may be settling). */
export const RECONCILE_GRACE_S = 120;
export const RECONCILE_EVERY_MS = 60_000;

/**
 * Finds active, dispatched downloads whose fetch job no longer exists (a job dropped after too
 * many stalls, a cancel or settle racing a new requester) and adds the job back from the row's snapshot,
 * so a person's slots are never held by work nobody will do. Returns how many jobs it re-added.
 */
export async function reconcileOnce(ctx: DownloadContext): Promise<number> {
  const rows = await ctx.db
    .selectFrom("downloads as d")
    .innerJoin("format_profiles as p", "p.id", "d.profile_id")
    .distinctOn("d.fetch_key")
    .select([
      "d.fetch_key",
      "d.extractor",
      "d.video_id",
      "d.url",
      "d.profile_id",
      "d.profile_revision",
      "d.args",
      "p.name as profile_name",
    ])
    .where("d.state", "in", ["queued", "running"])
    .where("d.dispatched_at", "is not", null)
    .where("d.dispatched_at", "<", sql<Date>`now() - make_interval(secs => ${RECONCILE_GRACE_S})`)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("jobs")
            .select("jobs.id")
            .where("jobs.queue", "=", "download")
            .whereRef("jobs.key", "=", "d.fetch_key"),
        ),
      ),
    )
    .orderBy("d.fetch_key")
    .execute();
  let added = 0;
  for (const r of rows) {
    await addFetchJob(ctx, r);
    added++;
    ctx.logger.warn({ fetchKey: r.fetch_key }, "re-added a fetch job that had gone missing");
  }
  return added;
}

/**
 * Lets go of holds the limit no longer makes (docs/downloads.md "Large downloads"): after it was
 * raised, or set to 0, a download held under the old one is dispatched as any other, and its fetch
 * asks yt-dlp the size anew. Returns how many it let go.
 */
export async function releaseHolds(ctx: DownloadContext): Promise<number> {
  const limit = ctx.limits.largeDownloadBytes;
  const released = await ctx.db
    .updateTable("downloads")
    .set({ size_held_bytes: null, size_held_at: null })
    .where("state", "=", "queued")
    .where("size_held_at", "is not", null)
    // A BIGINT reads as a string (pg); Postgres casts the bound text back to compare.
    .$if(limit > 0, (qb) => qb.where("size_held_bytes", "<=", String(limit)))
    .returning(["id", "user_id"])
    .execute();
  if (released.length === 0) return 0;
  ctx.logger.info({ released: released.length, limit }, "let go of holds under the limit");
  await publishDownloadEvents(
    ctx.db,
    released.map((r) => ({ kind: "state", downloadId: r.id, userId: r.user_id })),
  );
  for (const userId of new Set(released.map((r) => r.user_id))) await dispatchFor(ctx, userId);
  return released.length;
}

/** The leader's duty: reconcile every minute until leadership ends. */
export function reconcileDuty(ctx: DownloadContext) {
  return async (signal: AbortSignal): Promise<void> => {
    const pass = async () => {
      try {
        await reconcileOnce(ctx);
        await releaseHolds(ctx);
      } catch (err) {
        ctx.logger.warn({ err }, "reconciling download jobs failed");
      }
    };
    await pass();
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const every = setInterval(() => void pass(), RECONCILE_EVERY_MS);
      signal.addEventListener(
        "abort",
        () => {
          clearInterval(every);
          resolve();
        },
        { once: true },
      );
    });
  };
}
