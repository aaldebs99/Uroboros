import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/** Past this fraction of the duration a video counts as watched. */
export const WATCHED_AT = 0.9;

/**
 * Records where the person is. The position is clamped to the duration; once watched, a later
 * report from earlier in the video (a rewatch, a report arriving late) does not un-watch it, and
 * `watched_at` keeps the moment it first counted (retention's "watched X days ago").
 */
export async function saveProgress(
  db: Kysely<Database>,
  userId: string,
  mediaId: string,
  position: number,
  duration: number,
): Promise<void> {
  const clamped = Math.min(Math.max(position, 0), duration);
  const watched = clamped >= WATCHED_AT * duration;
  await db
    .insertInto("watch_progress")
    .values({
      user_id: userId,
      media_id: mediaId,
      position_s: clamped,
      duration_s: duration,
      watched,
      watched_at: watched ? new Date() : null,
    })
    .onConflict((oc) =>
      oc.columns(["user_id", "media_id"]).doUpdateSet({
        position_s: clamped,
        duration_s: duration,
        watched: sql<boolean>`watch_progress.watched OR ${watched}`,
        watched_at: sql<Date | null>`CASE
          WHEN watch_progress.watched THEN coalesce(watch_progress.watched_at, now())
          WHEN ${watched} THEN now()
          ELSE NULL END`,
        updated_at: new Date(),
      }),
    )
    .execute();
}

/** Marks watched or not; unwatching also starts it over and forgets when it was watched. */
export async function setWatched(
  db: Kysely<Database>,
  userId: string,
  media: { id: string; duration: number | null },
  watched: boolean,
): Promise<void> {
  const duration = media.duration !== null && media.duration > 0 ? media.duration : 1;
  await db
    .insertInto("watch_progress")
    .values({
      user_id: userId,
      media_id: media.id,
      position_s: 0,
      duration_s: duration,
      watched,
      watched_at: watched ? new Date() : null,
    })
    .onConflict((oc) =>
      oc.columns(["user_id", "media_id"]).doUpdateSet({
        watched,
        watched_at: watched ? sql<Date>`coalesce(watch_progress.watched_at, now())` : null,
        ...(watched ? {} : { position_s: 0 }),
        updated_at: new Date(),
      }),
    )
    .execute();
}
