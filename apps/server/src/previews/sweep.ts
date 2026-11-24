import { sql } from "kysely";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { queuePreview } from "./queue.ts";
import { hasStoredVideo, previewsStalled } from "./stall.ts";

export const PREVIEW_SWEEP_EVERY_MS = 60_000;
/** Previews queued per pass: a library works through at the encoder's pace, never flooding `jobs`. */
export const PREVIEW_SWEEP_BATCH = 30;

/** Whether the last pass found previews stalled, so it says so once rather than every minute. */
let saidStalled = false;

/**
 * The leader's backfill of hover previews (docs/library.md "Hover previews"): queues the media
 * with a stored video and no preview, none failed for good, and none already queued. While
 * previews are stalled (no replica makes them) it queues none, and warns once how to fix it.
 */
export async function sweepPreviews(ctx: DownloadContext): Promise<number> {
  if (await previewsStalled(ctx.db)) {
    if (!saidStalled) {
      ctx.logger.warn(
        "hover previews are waiting and no replica is making them: set UROBOROS_TRANSCODE_CONCURRENCY above 0 on a replica, or UROBOROS_GENERATE_PREVIEWS=false",
      );
    }
    saidStalled = true;
    return 0;
  }
  saidStalled = false;
  const due = await ctx.db
    .selectFrom("media as m")
    .select("m.id")
    .where("m.preview_key", "is", null)
    .where("m.preview_failed_at", "is", null)
    .where(hasStoredVideo)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("jobs as j")
            .select("j.id")
            .where("j.queue", "=", "preview")
            .where("j.key", "=", sql<string>`'preview:' || m.id`),
        ),
      ),
    )
    .orderBy("m.created_at", "desc")
    .limit(PREVIEW_SWEEP_BATCH)
    .execute();
  // In one transaction, so the nudges to each person fold into one (Postgres drops a repeated
  // payload within a transaction) rather than one per video.
  await ctx.db.transaction().execute(async (tx) => {
    for (const { id } of due) await queuePreview(ctx, id, tx);
  });
  if (due.length > 0) ctx.logger.info({ queued: due.length }, "queued hover previews");
  return due.length;
}
