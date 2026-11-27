import type { PreviewWork } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { eff } from "../library/edits.ts";
import { hasStoredVideo, previewsStalled } from "./stall.ts";

/**
 * A person's hover previews being made (docs/library.md "Hover previews"), for the bell: over the
 * stored videos in their library, how many wait for a preview, and the one being made (else the
 * next queued). While previews are on (`generating`) every video still without one waits, so the
 * bell stays up between the backfill's passes; while off, only those already queued. A job still
 * finishing for a video that has its preview (or failed for good) no longer counts, and none waits
 * while previews are stalled (`previewsStalled`).
 */
export async function previewWork(
  db: Kysely<Database>,
  userId: string,
  generating: boolean,
): Promise<PreviewWork> {
  const pending = sql<boolean>`m.preview_key IS NULL AND m.preview_failed_at IS NULL`;
  const counts = await db
    .selectFrom("media as m")
    .leftJoin("jobs as j", (join) =>
      join.on(sql<boolean>`j.queue = 'preview' AND j.key = 'preview:' || m.id`),
    )
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("library_entries as e")
          .select("e.id")
          .whereRef("e.media_id", "=", "m.id")
          .where("e.user_id", "=", userId),
      ),
    )
    .where(hasStoredVideo)
    .select([
      sql<string>`count(j.id) FILTER (WHERE ${pending})`.as("queued"),
      sql<string>`count(*) FILTER (WHERE ${pending})`.as("left"),
    ])
    .executeTakeFirstOrThrow();
  const candidates = Number(generating ? counts.left : counts.queued);
  // Stalled previews (no replica makes them) are not in progress: nothing would ever finish them.
  const waiting = candidates > 0 && !(await previewsStalled(db)) ? candidates : 0;
  const next =
    waiting === 0
      ? undefined
      : await db
          .selectFrom("jobs as j")
          .innerJoin("media as m", (join) => join.on(sql<boolean>`j.key = 'preview:' || m.id`))
          .innerJoin("library_entries as e", "e.media_id", "m.id")
          .leftJoin("media_edits as ed", (join) =>
            join.onRef("ed.media_id", "=", "e.media_id").onRef("ed.user_id", "=", "e.user_id"),
          )
          .where("j.queue", "=", "preview")
          .where("e.user_id", "=", userId)
          .where(pending)
          .where(hasStoredVideo)
          .select([
            "e.id as entry_id",
            sql<string>`coalesce(${eff.title}, m.video_id)`.as("title"),
            sql<boolean>`j.state = 'running'`.as("running"),
          ])
          .orderBy(sql`j.state = 'running'`, "desc")
          .orderBy("j.run_at")
          .orderBy("j.id")
          .executeTakeFirst();
  return {
    waiting,
    next:
      next === undefined
        ? null
        : { entryId: next.entry_id, title: next.title, running: next.running },
  };
}
