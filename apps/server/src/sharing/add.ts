import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { visibleEntry } from "./access.ts";

/**
 * Add to my library (docs/sharing.md): gives the caller their own entry on the same stored file as
 * an entry they may see. Instant, since the file is already stored; an entry they already have on
 * that file (their own, or added before) is answered as it is, `created` false.
 */
export async function addToLibrary(
  db: Kysely<Database>,
  userId: string,
  entryId: string,
): Promise<{ id: string; created: boolean }> {
  const seen = await visibleEntry(db, { userId }, entryId);
  if (seen.own) return { id: seen.id, created: false };
  const inserted = await db
    .insertInto("library_entries")
    .values({ user_id: userId, media_id: seen.media_id, rendition_id: seen.rendition_id })
    .onConflict((oc) => oc.columns(["user_id", "rendition_id"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (inserted !== undefined) return { id: inserted.id, created: true };
  const existing = await db
    .selectFrom("library_entries")
    .select("id")
    .where("user_id", "=", userId)
    .where("rendition_id", "=", seen.rendition_id)
    .executeTakeFirstOrThrow();
  return { id: existing.id, created: false };
}
