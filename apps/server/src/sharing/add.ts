import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { copyEdits } from "../library/ownDetails.ts";
import { visibleEntry } from "./access.ts";

/**
 * Add to my library (docs/sharing.md): gives the caller their own entry on the same stored file as
 * an entry they may see, in its owner's own details if they had none of the video
 * (docs/library.md#your-own-details). Instant, since the file is already stored; an entry they
 * already have on that file (their own, or added before) is answered as it is, `created` false.
 */
export async function addToLibrary(
  db: Kysely<Database>,
  userId: string,
  entryId: string,
): Promise<{ id: string; created: boolean }> {
  const seen = await visibleEntry(db, { userId }, entryId);
  if (seen.own) return { id: seen.id, created: false };
  const inserted = await db.transaction().execute(async (tx) => {
    await copyEdits(tx, userId, [entryId]);
    return tx
      .insertInto("library_entries")
      .values({ user_id: userId, media_id: seen.media_id, rendition_id: seen.rendition_id })
      .onConflict((oc) => oc.columns(["user_id", "rendition_id"]).doNothing())
      .returning("id")
      .executeTakeFirst();
  });
  if (inserted !== undefined) return { id: inserted.id, created: true };
  const existing = await db
    .selectFrom("library_entries")
    .select("id")
    .where("user_id", "=", userId)
    .where("rendition_id", "=", seen.rendition_id)
    .executeTakeFirstOrThrow();
  return { id: existing.id, created: false };
}

/**
 * Gives the caller their own entries on the same files as these entries, which they were checked
 * to reach, and answers the caller's entry ids in the same order (one per file).
 */
export async function addManyToLibrary(
  db: Kysely<Database>,
  userId: string,
  entryIds: readonly string[],
): Promise<string[]> {
  if (entryIds.length === 0) return [];
  return db.transaction().execute(async (tx) => {
    await copyEdits(tx, userId, entryIds);
    await tx
      .insertInto("library_entries")
      .columns(["user_id", "media_id", "rendition_id"])
      .expression((eb) =>
        eb
          .selectFrom("library_entries")
          .select([eb.val(userId).as("user_id"), "media_id", "rendition_id"])
          .where("id", "in", entryIds),
      )
      .onConflict((oc) => oc.columns(["user_id", "rendition_id"]).doNothing())
      .execute();
    const pairs = await tx
      .selectFrom("library_entries as theirs")
      .innerJoin("library_entries as mine", (j) =>
        j.onRef("mine.rendition_id", "=", "theirs.rendition_id").on("mine.user_id", "=", userId),
      )
      .select(["theirs.id as theirs", "mine.id as mine"])
      .where("theirs.id", "in", entryIds)
      .execute();
    const mine = new Map(pairs.map((p) => [p.theirs, p.mine]));
    const out = entryIds.flatMap((id) => {
      const m = mine.get(id);
      return m === undefined ? [] : [m];
    });
    return [...new Set(out)];
  });
}
