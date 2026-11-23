import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/** Replaces an entry's tags (already normalized by the contract); returns them sorted. */
export async function replaceTags(
  db: Kysely<Database>,
  entryId: string,
  tags: readonly string[],
): Promise<string[]> {
  const sorted = [...new Set(tags)].sort();
  await db.transaction().execute(async (tx) => {
    await tx.deleteFrom("entry_tags").where("entry_id", "=", entryId).execute();
    if (sorted.length > 0) {
      await tx
        .insertInto("entry_tags")
        .values(sorted.map((tag) => ({ entry_id: entryId, tag })))
        .execute();
    }
  });
  return sorted;
}
