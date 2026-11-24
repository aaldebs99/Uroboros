import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ownEntry } from "../downloads/library.ts";

/** Keeps one of the person's own entries out of automatic clean-up, or lets it go again. */
export async function setKept(
  db: Kysely<Database>,
  userId: string,
  entryId: string,
  kept: boolean,
): Promise<void> {
  const entry = await ownEntry(db, userId, entryId);
  await db.updateTable("library_entries").set({ kept }).where("id", "=", entry.id).execute();
}
