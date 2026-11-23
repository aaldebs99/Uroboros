import type { ShareKind } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { getPlaylist } from "../playlists/listing.ts";

/** What a shared thing looks like from its owner's library. */
export interface TargetFacts {
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  /** A playlist's videos (the owner's); null for one video. */
  count: number | null;
  /** The entry whose thumbnail stands for it, if any has one. */
  coverEntryId: string | null;
}

/** The entry id in a library thumbnail URL (`/api/library/<id>/thumbnail`). */
const coverOf = (url: string | null) =>
  /^\/api\/library\/([0-9a-f-]+)\/thumbnail$/.exec(url ?? "")?.[1] ?? null;

/** The facts of `ownerId`'s entry, manual playlist or YouTube playlist; 404 when it is not theirs. */
export async function describeTarget(
  db: Kysely<Database>,
  ownerId: string,
  kind: ShareKind,
  id: string,
): Promise<TargetFacts> {
  if (kind === "entry") {
    const row = await db
      .selectFrom("library_entries as e")
      .innerJoin("media as m", "m.id", "e.media_id")
      .select(["m.title", "m.video_id", "m.description", "m.thumbnail_key"])
      .where("e.id", "=", id)
      .where("e.user_id", "=", ownerId)
      .executeTakeFirst();
    if (row === undefined) throw new ApiError("not_found", "no such library entry");
    return {
      title: row.title ?? row.video_id,
      description: row.description,
      thumbnailUrl: row.thumbnail_key === null ? null : `/api/library/${id}/thumbnail`,
      count: null,
      coverEntryId: row.thumbnail_key === null ? null : id,
    };
  }
  const playlist = await getPlaylist(db, ownerId, id);
  if (playlist.kind !== (kind === "playlist" ? "manual" : "youtube")) {
    throw new ApiError("not_found", "no such playlist");
  }
  return {
    title: playlist.name,
    description: playlist.description,
    thumbnailUrl: playlist.coverThumbnailUrl,
    count: playlist.count,
    coverEntryId: coverOf(playlist.coverThumbnailUrl),
  };
}
