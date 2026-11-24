import type { PreviewWork } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/**
 * A person's hover previews being made (docs/library.md "Hover previews"), for the bell: over the
 * stored videos in their library, how many wait on a live `preview` job, how many are made and
 * how many are left, and the one being made (else the next). A job still finishing for a video
 * that has its preview (or failed for good) no longer counts.
 */
export async function previewWork(db: Kysely<Database>, userId: string): Promise<PreviewWork> {
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
    .select([
      sql<string>`count(j.id) FILTER (WHERE ${pending})`.as("queued"),
      sql<string>`count(*) FILTER (WHERE ${pending})`.as("left"),
      sql<string>`count(*) FILTER (WHERE m.preview_key IS NOT NULL)`.as("made"),
    ])
    .executeTakeFirstOrThrow();
  const queued = Number(counts.queued);
  const next =
    queued === 0
      ? undefined
      : await db
          .selectFrom("jobs as j")
          .innerJoin("media as m", (join) => join.on(sql<boolean>`j.key = 'preview:' || m.id`))
          .innerJoin("library_entries as e", "e.media_id", "m.id")
          .where("j.queue", "=", "preview")
          .where("e.user_id", "=", userId)
          .where(pending)
          .select([
            "e.id as entry_id",
            sql<string>`coalesce(m.title, m.video_id)`.as("title"),
            sql<boolean>`j.state = 'running'`.as("running"),
          ])
          .orderBy(sql`j.state = 'running'`, "desc")
          .orderBy("j.run_at")
          .orderBy("j.id")
          .executeTakeFirst();
  return {
    queued,
    left: Number(counts.left),
    made: Number(counts.made),
    next:
      next === undefined
        ? null
        : { entryId: next.entry_id, title: next.title, running: next.running },
  };
}
