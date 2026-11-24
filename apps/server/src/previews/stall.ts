import { sql, type ExpressionBuilder, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/**
 * Whether hover previews are stalled (docs/library.md "Hover previews"): previews wait, overdue,
 * and none is being made. Only replicas that run playback sessions consume the `preview` queue, and
 * one that does always has a preview running while any wait, so this means no replica makes them
 * (every `UROBOROS_TRANSCODE_CONCURRENCY` is 0). The bell then shows none in progress, and the
 * leader's backfill stops queueing more and says why once.
 */

/** A waiting preview overdue by this much, with none running, means nobody is making them. */
export const PREVIEW_STALL_AFTER_MS = 5 * 60_000;

export async function previewsStalled(db: Kysely<Database>): Promise<boolean> {
  const row = await db
    .selectNoFrom([
      sql<boolean>`EXISTS (SELECT 1 FROM jobs WHERE queue = 'preview' AND state = 'running')`.as(
        "running",
      ),
      sql<boolean>`EXISTS (SELECT 1 FROM jobs WHERE queue = 'preview' AND state = 'queued'
        AND run_at < now() - make_interval(secs => ${PREVIEW_STALL_AFTER_MS / 1000}))`.as(
        "overdue",
      ),
    ])
    .executeTakeFirstOrThrow();
  return !row.running && row.overdue;
}

/** A media with a stored video (a live rendition with a video stream): the ones that get a preview. */
export const hasStoredVideo = (eb: ExpressionBuilder<Database & { m: Database["media"] }, "m">) =>
  eb.exists(
    eb
      .selectFrom("renditions as r")
      .select("r.id")
      .whereRef("r.media_id", "=", "m.id")
      .where("r.video_codec", "is not", null)
      .where("r.orphaned_at", "is", null),
  );
