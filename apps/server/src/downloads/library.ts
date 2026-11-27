import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { EDITED_COLUMNS } from "../library/edits.ts";

/**
 * One library entry with what serving and listing it needs, in its owner's own details of the video
 * (docs/library.md#your-own-details). The profile is a left join: an upload's rendition has none,
 * nor has one whose profile went with its owner's account.
 */
export function entryQuery(db: Kysely<Database>) {
  return db
    .selectFrom("library_entries as e")
    .innerJoin("media as m", "m.id", "e.media_id")
    .innerJoin("renditions as r", "r.id", "e.rendition_id")
    .leftJoin("format_profiles as p", "p.id", "r.profile_id")
    .leftJoin("media_edits as ed", (j) =>
      j.onRef("ed.media_id", "=", "e.media_id").onRef("ed.user_id", "=", "e.user_id"),
    )
    .select([
      "e.id",
      "e.user_id",
      "e.media_id",
      "e.rendition_id",
      "e.added_at",
      ...EDITED_COLUMNS,
      "m.video_id",
      "m.extractor",
      "m.uploader",
      "m.upload_date",
      "m.duration",
      "m.thumbnail_key",
      "m.preview_key",
      "r.storage_key",
      "r.size_bytes",
      "r.container",
      "p.name as profile_name",
    ]);
}

/** The caller's own entry; another person's is 404. */
export async function ownEntry(db: Kysely<Database>, userId: string, id: string) {
  const row = await entryQuery(db)
    .where("e.id", "=", id)
    .where("e.user_id", "=", userId)
    .executeTakeFirst();
  if (row === undefined) throw new ApiError("not_found", "no such library entry");
  return row;
}

export async function removeEntry(db: Kysely<Database>, userId: string, id: string): Promise<void> {
  const res = await db
    .deleteFrom("library_entries")
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (res.numDeletedRows === 0n) throw new ApiError("not_found", "no such library entry");
}
