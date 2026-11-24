import { sql } from "kysely";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { EXPORT_KEEP_MS } from "./store.ts";

export const EXPORT_SWEEP_EVERY_MS = 60_000;
/** A copy queued or running this long with no job left was dropped (its runs stalled out). */
const LOST_AFTER_MS = 5 * 60_000;

/**
 * The leader's sweep of copies to save (docs/transcoding.md): drops those a day past finishing
 * (the trash trigger queues their files for the reaper), and fails those whose job is gone.
 */
export async function sweepExports(ctx: DownloadContext): Promise<void> {
  const expired = await ctx.db
    .deleteFrom("exports")
    .where("finished_at", "<", sql<Date>`now() - make_interval(secs => ${EXPORT_KEEP_MS / 1000})`)
    .executeTakeFirst();
  const lost = await ctx.db
    .updateTable("exports as x")
    .set({ state: "failed", error: "the copy was interrupted; try again", finished_at: sql`now()` })
    .where("x.state", "in", ["queued", "running"])
    .where("x.created_at", "<", sql<Date>`now() - make_interval(secs => ${LOST_AFTER_MS / 1000})`)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("jobs as j")
            .select("j.id")
            .where("j.queue", "=", "export")
            .where("j.key", "=", sql<string>`'export:' || x.id`),
        ),
      ),
    )
    .executeTakeFirst();
  if (expired.numDeletedRows > 0n || lost.numUpdatedRows > 0n) {
    ctx.logger.info(
      { expired: Number(expired.numDeletedRows), lost: Number(lost.numUpdatedRows) },
      "swept copies to save",
    );
  }
}
