import type { PlaylistDetail, PlaylistKind, PlaylistSummary } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";

/** A playlist of either kind: a manual playlist's id, or a YouTube playlist's (`sources`) id. */
export interface PlaylistTarget {
  kind: PlaylistKind;
  id: string;
}

const thumb = (entryId: string | null) =>
  entryId === null ? null : `/api/library/${entryId}/thumbnail`;

interface Row {
  id: string;
  name: string | null;
  description: string | null;
  url: string | null;
  updated: Date;
  count: string;
  cover: string | null;
}

function toDetail(kind: PlaylistKind, r: Row): PlaylistDetail {
  return {
    id: r.id,
    kind,
    name: r.name ?? "Untitled playlist",
    count: Number(r.count),
    coverThumbnailUrl: thumb(r.cover),
    url: r.url,
    updatedAt: r.updated.toISOString(),
    description: r.description,
  };
}

function manualRows(db: Kysely<Database>, userId: string) {
  return db
    .selectFrom("playlists as p")
    .where("p.user_id", "=", userId)
    .select([
      "p.id",
      "p.name",
      "p.description",
      sql<null>`NULL::text`.as("url"),
      sql<Date>`p.updated_at`.as("updated"),
      sql<string>`(SELECT count(*) FROM playlist_items pi WHERE pi.playlist_id = p.id)`.as("count"),
      sql<string | null>`(
        SELECT pi.entry_id FROM playlist_items pi
        JOIN library_entries e ON e.id = pi.entry_id
        JOIN media m ON m.id = e.media_id
        WHERE pi.playlist_id = p.id AND m.thumbnail_key IS NOT NULL
        ORDER BY pi.position LIMIT 1)`.as("cover"),
    ])
    .orderBy("p.updated_at", "desc");
}

/** The caller's YouTube playlists, with how many of their own entries each holds. */
function youtubeRows(db: Kysely<Database>, userId: string) {
  const mine = sql`
    FROM source_items si
    JOIN media m ON m.extractor = si.extractor AND m.video_id = si.video_id
    JOIN library_entries e ON e.media_id = m.id AND e.user_id = ${userId}
    WHERE si.source_id = s.id`;
  return db
    .selectFrom("user_sources as us")
    .innerJoin("sources as s", "s.id", "us.source_id")
    .where("us.user_id", "=", userId)
    .select([
      "s.id",
      sql<string | null>`s.title`.as("name"),
      sql<null>`NULL::text`.as("description"),
      "s.url",
      sql<Date>`us.queued_at`.as("updated"),
      sql<string>`(SELECT count(DISTINCT e.id) ${mine})`.as("count"),
      sql<string | null>`(SELECT e.id ${mine} AND m.thumbnail_key IS NOT NULL
        ORDER BY si.position LIMIT 1)`.as("cover"),
    ])
    .orderBy("us.queued_at", "desc");
}

/** The caller's playlists: manual ones (last changed first), then YouTube ones holding their videos. */
export async function listPlaylists(
  db: Kysely<Database>,
  userId: string,
): Promise<PlaylistSummary[]> {
  const [manual, youtube] = await Promise.all([
    manualRows(db, userId).execute(),
    youtubeRows(db, userId).execute(),
  ]);
  const strip = ({ description: _d, ...summary }: PlaylistDetail): PlaylistSummary => summary;
  return [
    ...manual.map((r) => strip(toDetail("manual", r))),
    ...youtube.filter((r) => Number(r.count) > 0).map((r) => strip(toDetail("youtube", r))),
  ];
}

/** Which kind of the caller's playlist `id` is, or null when it is none of theirs. */
export async function playlistKind(
  db: Kysely<Database>,
  userId: string,
  id: string,
): Promise<PlaylistKind | null> {
  const [manual, youtube] = await Promise.all([
    db
      .selectFrom("playlists")
      .select("id")
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .executeTakeFirst(),
    db
      .selectFrom("user_sources")
      .select("source_id")
      .where("source_id", "=", id)
      .where("user_id", "=", userId)
      .executeTakeFirst(),
  ]);
  if (manual !== undefined) return "manual";
  return youtube === undefined ? null : "youtube";
}

/** One of the caller's playlists, of either kind; another person's is 404. */
export async function getPlaylist(
  db: Kysely<Database>,
  userId: string,
  id: string,
): Promise<PlaylistDetail> {
  const manual = await manualRows(db, userId).where("p.id", "=", id).executeTakeFirst();
  if (manual !== undefined) return toDetail("manual", manual);
  const youtube = await youtubeRows(db, userId).where("s.id", "=", id).executeTakeFirst();
  if (youtube !== undefined) return toDetail("youtube", youtube);
  throw new ApiError("not_found", "no such playlist");
}

/** The owner's entries in a playlist, in its order (callers check the owner may be asked). */
export async function playlistEntryIds(
  db: Kysely<Database>,
  ownerId: string,
  target: PlaylistTarget,
): Promise<string[]> {
  if (target.kind === "manual") {
    const rows = await db
      .selectFrom("playlist_items")
      .select("entry_id")
      .where("playlist_id", "=", target.id)
      .where("user_id", "=", ownerId)
      .orderBy("position")
      .execute();
    return rows.map((r) => r.entry_id);
  }
  const rows = await db
    .selectFrom("source_items as si")
    .innerJoin("media as m", (j) =>
      j.onRef("m.extractor", "=", "si.extractor").onRef("m.video_id", "=", "si.video_id"),
    )
    .innerJoin("library_entries as e", (j) =>
      j.onRef("e.media_id", "=", "m.id").on("e.user_id", "=", ownerId),
    )
    .select("e.id")
    .where("si.source_id", "=", target.id)
    .orderBy("si.position")
    .orderBy("e.id")
    .execute();
  return rows.map((r) => r.id);
}

/** The caller's manual playlists holding an entry, by name. */
export async function playlistsHolding(
  db: Kysely<Database>,
  userId: string,
  entryId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .selectFrom("playlist_items as pi")
    .innerJoin("playlists as p", "p.id", "pi.playlist_id")
    .select(["p.id", "p.name"])
    .where("pi.entry_id", "=", entryId)
    .where("pi.user_id", "=", userId)
    .orderBy("p.name")
    .execute();
}
