import type { LibraryEntry } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";

function dashed(date: string | null): string | null {
  const m = date === null ? null : /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  return m === null ? null : `${m[1] ?? ""}-${m[2] ?? ""}-${m[3] ?? ""}`;
}

/** One library entry with what serving and listing it needs. */
export function entryQuery(db: Kysely<Database>) {
  return db
    .selectFrom("library_entries as e")
    .innerJoin("media as m", "m.id", "e.media_id")
    .innerJoin("renditions as r", "r.id", "e.rendition_id")
    .innerJoin("format_profiles as p", "p.id", "r.profile_id")
    .select([
      "e.id",
      "e.user_id",
      "e.media_id",
      "e.added_at",
      "m.title",
      "m.video_id",
      "m.channel",
      "m.uploader",
      "m.upload_date",
      "m.duration",
      "m.thumbnail_key",
      "r.storage_key",
      "r.size_bytes",
      "r.container",
      "p.name as profile_name",
    ]);
}

export async function listLibrary(db: Kysely<Database>, userId: string): Promise<LibraryEntry[]> {
  const rows = await entryQuery(db)
    .where("e.user_id", "=", userId)
    .orderBy("e.added_at", "desc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    mediaId: r.media_id,
    title: r.title ?? r.video_id,
    channel: r.channel ?? r.uploader,
    uploadDate: dashed(r.upload_date),
    duration: r.duration,
    thumbnailUrl: r.thumbnail_key === null ? null : `/api/library/${r.id}/thumbnail`,
    profileName: r.profile_name,
    sizeBytes: Number(r.size_bytes),
    container: r.container,
    addedAt: r.added_at.toISOString(),
  }));
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
