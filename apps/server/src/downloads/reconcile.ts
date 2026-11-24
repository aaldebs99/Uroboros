import { sql } from "kysely";
import { addFetchJob, type DownloadContext } from "./dispatch.ts";

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

/** The leader's duty: reconcile every minute until leadership ends. */
export function reconcileDuty(ctx: DownloadContext) {
  return async (signal: AbortSignal): Promise<void> => {
    const pass = async () => {
      try {
        await reconcileOnce(ctx);
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
