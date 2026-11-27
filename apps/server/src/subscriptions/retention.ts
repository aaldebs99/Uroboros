import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

export const RETENTION_EVERY_MS = 3_600_000;

/** Not kept, not in one of its owner's playlists, and not shared on its own. */
const notExempt = (e: ReturnType<typeof sql>) => sql`NOT ${e}.kept
  AND NOT EXISTS (SELECT 1 FROM playlist_items pi WHERE pi.entry_id = ${e}.id)
  AND NOT EXISTS (SELECT 1 FROM shares sh WHERE sh.entry_id = ${e}.id)
  AND NOT EXISTS (SELECT 1 FROM clip_shares cs WHERE cs.entry_id = ${e}.id)`;

/**
 * Applies every subscription's retention to its owner's library (docs/automation.md): beyond the
 * newest `keep_last` (by upload date, then added) and anything watched more than
 * `delete_watched_after_days` ago goes. Only entries the subscription brought count, and an
 * exempt entry (kept, in one of its owner's playlists, or shared on its own: docs/sharing.md)
 * neither counts toward N nor goes. Removing deletes the entry; files are the reaper's.
 * Returns how many entries went.
 */
export async function applyRetention(db: Kysely<Database>): Promise<number> {
  const rules = await db
    .selectFrom("subscriptions")
    .select(["id", "user_id", "keep_last", "delete_watched_after_days"])
    .where((eb) =>
      eb.or([eb("keep_last", "is not", null), eb("delete_watched_after_days", "is not", null)]),
    )
    .execute();
  let removed = 0;
  for (const r of rules) {
    if (r.keep_last !== null) {
      const res = await sql`
        DELETE FROM library_entries e
        USING (
          SELECT e2.id, row_number() OVER (
            ORDER BY m.upload_date DESC NULLS LAST, e2.added_at DESC, e2.id DESC
          ) AS rank
          FROM library_entries e2
          JOIN media m ON m.id = e2.media_id
          WHERE e2.subscription_id = ${r.id} AND e2.user_id = ${r.user_id} AND ${notExempt(sql`e2`)}
        ) ranked
        WHERE e.id = ranked.id AND ranked.rank > ${r.keep_last}`.execute(db);
      removed += Number(res.numAffectedRows ?? 0n);
    }
    if (r.delete_watched_after_days !== null) {
      const res = await sql`
        DELETE FROM library_entries e
        USING watch_progress wp
        WHERE e.subscription_id = ${r.id} AND e.user_id = ${r.user_id} AND ${notExempt(sql`e`)}
          AND wp.user_id = e.user_id AND wp.media_id = e.media_id AND wp.watched
          AND wp.watched_at < now() - make_interval(days => ${r.delete_watched_after_days})`.execute(
        db,
      );
      removed += Number(res.numAffectedRows ?? 0n);
    }
  }
  return removed;
}
