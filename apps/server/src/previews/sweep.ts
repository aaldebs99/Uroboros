import { sql } from "kysely";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { queuePreview } from "./queue.ts";

export const PREVIEW_SWEEP_EVERY_MS = 60_000;
/** Previews queued per pass: a library works through at the encoder's pace, never flooding `jobs`. */
export const PREVIEW_SWEEP_BATCH = 30;

/**
 * The leader's backfill of hover previews (docs/library.md "Hover previews"): queues the media
 * with a stored video and no preview, none failed for good, and none already queued.
 */
export async function sweepPreviews(ctx: DownloadContext): Promise<number> {
  const due = await ctx.db
    .selectFrom("media as m")
    .select("m.id")
    .where("m.preview_key", "is", null)
    .where("m.preview_failed_at", "is", null)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("renditions as r")
          .select("r.id")
          .whereRef("r.media_id", "=", "m.id")
          .where("r.video_codec", "is not", null)
          .where("r.orphaned_at", "is", null),
      ),
    )
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
  for (const { id } of due) await queuePreview(ctx, id);
  if (due.length > 0) ctx.logger.info({ queued: due.length }, "queued hover previews");
  return due.length;
}
