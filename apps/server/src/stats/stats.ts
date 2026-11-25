import type {
  AdminStats,
  ContainerStats,
  MediaFileCounts,
  PersonStats,
  StorageStats,
} from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/**
 * Admin › Stats (docs/library.md "Stats"): the stored media files, their containers, everything
 * stored by kind, and each person's library and storage. A file is stored once for everyone who
 * has it and counts for whoever's entry for it is oldest (of entries made together, whoever asked
 * first); its media's thumbnail, info file, preview and subtitles count for whoever's entry for that
 * media is.
 */

/** pg reads `count` and `sum` of a BIGINT as strings; a sum over no rows is null. */
const n = (v: string | number | null | undefined): number => Number(v ?? 0);

/**
 * When the entry `e`'s person first asked for its file: one fetch settles everyone waiting on it in
 * one transaction, so their entries share `added_at`, and whoever queued it first had it first.
 */
const askedAt = sql`(SELECT min(d.created_at) FROM downloads d
  WHERE d.rendition_id = e.rendition_id AND d.user_id = e.user_id) NULLS LAST`;

/** A media's own files beside its renditions: thumbnail, info file, preview and subtitles. */
const extrasOf = (media: string) => sql<string>`
  coalesce(${sql.ref(`${media}.thumbnail_bytes`)}, 0)
  + coalesce(${sql.ref(`${media}.info_bytes`)}, 0)
  + coalesce(${sql.ref(`${media}.preview_bytes`)}, 0)
  + coalesce((SELECT sum(s.size_bytes) FROM subtitles s WHERE s.media_id = ${sql.ref(`${media}.id`)}), 0)`;

async function mediaFiles(db: Kysely<Database>): Promise<MediaFileCounts> {
  const row = await db
    .selectFrom("renditions")
    .select([
      sql<string>`count(*)`.as("total"),
      sql<string>`count(*) FILTER (WHERE video_codec IS NOT NULL)`.as("videos"),
      sql<string>`count(*) FILTER (WHERE video_codec IS NULL)`.as("audio"),
      sql<string>`sum(size_bytes)`.as("bytes"),
    ])
    .executeTakeFirstOrThrow();
  return { total: n(row.total), videos: n(row.videos), audio: n(row.audio), bytes: n(row.bytes) };
}

async function containers(db: Kysely<Database>): Promise<ContainerStats[]> {
  const rows = await sql<{ container: string; files: string; bytes: string }>`
    SELECT lower(coalesce(container, 'unknown')) AS container, count(*) AS files,
      sum(size_bytes) AS bytes
    FROM renditions GROUP BY 1 ORDER BY sum(size_bytes) DESC, 1`.execute(db);
  return rows.rows.map((r) => ({ container: r.container, files: n(r.files), bytes: n(r.bytes) }));
}

async function storage(db: Kysely<Database>, files: number): Promise<StorageStats> {
  const r = (
    await sql<Record<string, string | null>>`
      SELECT
        (SELECT sum(thumbnail_bytes) FROM media) AS thumbnails,
        (SELECT sum(info_bytes) FROM media) AS info,
        (SELECT sum(preview_bytes) FROM media) AS previews,
        (SELECT sum(size_bytes) FROM subtitles) AS subtitles,
        (SELECT sum(size_bytes) FROM exports) AS exports,
        (SELECT sum(size_bytes) FROM upload_parts) AS uploads,
        (SELECT sum(size_bytes) FROM playback_segments) AS playback,
        (SELECT count(*) FILTER (WHERE thumbnail_key IS NOT NULL AND thumbnail_bytes IS NULL)
          + count(*) FILTER (WHERE info_key IS NOT NULL AND info_bytes IS NULL)
          + count(*) FILTER (WHERE preview_key IS NOT NULL AND preview_bytes IS NULL) FROM media)
        + (SELECT count(*) FROM subtitles WHERE size_bytes IS NULL) AS unmeasured`.execute(db)
  ).rows[0];
  const parts: StorageStats["parts"] = [
    { kind: "files", bytes: files },
    { kind: "thumbnails", bytes: n(r?.["thumbnails"]) },
    { kind: "info", bytes: n(r?.["info"]) },
    { kind: "previews", bytes: n(r?.["previews"]) },
    { kind: "subtitles", bytes: n(r?.["subtitles"]) },
    { kind: "exports", bytes: n(r?.["exports"]) },
    { kind: "uploads", bytes: n(r?.["uploads"]) },
    { kind: "playback", bytes: n(r?.["playback"]) },
  ];
  return {
    total: parts.reduce((sum, p) => sum + p.bytes, 0),
    parts,
    unmeasured: n(r?.["unmeasured"]),
  };
}

/** Everyone, with their library's entries and the storage that counts for them. */
async function people(db: Kysely<Database>): Promise<PersonStats[]> {
  const rows = await sql<{
    id: string;
    display_name: string;
    username: string | null;
    items: string | null;
    videos: string | null;
    audio: string | null;
    bytes: string | null;
  }>`
    WITH first_file AS (
      SELECT DISTINCT ON (e.rendition_id) e.rendition_id, e.user_id
      FROM library_entries e ORDER BY e.rendition_id, e.added_at, ${askedAt}, e.id
    ), first_media AS (
      SELECT DISTINCT ON (e.media_id) e.media_id, e.user_id
      FROM library_entries e ORDER BY e.media_id, e.added_at, ${askedAt}, e.id
    ), owed AS (
      SELECT f.user_id, r.size_bytes AS bytes
        FROM first_file f JOIN renditions r ON r.id = f.rendition_id
      UNION ALL
      SELECT f.user_id, ${extrasOf("m")} FROM first_media f JOIN media m ON m.id = f.media_id
      UNION ALL
      SELECT user_id, size_bytes FROM exports WHERE size_bytes IS NOT NULL
      UNION ALL
      SELECT u.user_id, p.size_bytes FROM upload_parts p JOIN uploads u ON u.id = p.upload_id
    ), storage AS (
      SELECT user_id, sum(bytes) AS bytes FROM owed GROUP BY user_id
    ), items AS (
      SELECT e.user_id, count(*) AS items,
        count(*) FILTER (WHERE r.video_codec IS NOT NULL) AS videos,
        count(*) FILTER (WHERE r.video_codec IS NULL) AS audio
      FROM library_entries e JOIN renditions r ON r.id = e.rendition_id GROUP BY e.user_id
    )
    SELECT u.id, u.display_name, u.username, i.items, i.videos, i.audio, s.bytes
    FROM users u
    LEFT JOIN items i ON i.user_id = u.id
    LEFT JOIN storage s ON s.user_id = u.id
    ORDER BY coalesce(s.bytes, 0) DESC, coalesce(i.items, 0) DESC, lower(u.display_name), u.id`.execute(
    db,
  );
  return rows.rows.map((r) => ({
    userId: r.id,
    displayName: r.display_name,
    username: r.username,
    items: n(r.items),
    videos: n(r.videos),
    audio: n(r.audio),
    bytes: n(r.bytes),
  }));
}

/** The files no entry holds (the reaper's day of grace), with the files of media nobody has. */
async function unclaimed(db: Kysely<Database>): Promise<AdminStats["unclaimed"]> {
  const row = (
    await sql<{ files: string; bytes: string | null; extras: string | null }>`
      SELECT
        (SELECT count(*) FROM renditions r
          WHERE NOT EXISTS (SELECT 1 FROM library_entries e WHERE e.rendition_id = r.id)) AS files,
        (SELECT sum(r.size_bytes) FROM renditions r
          WHERE NOT EXISTS (SELECT 1 FROM library_entries e WHERE e.rendition_id = r.id)) AS bytes,
        (SELECT sum(${extrasOf("m")}) FROM media m
          WHERE NOT EXISTS (SELECT 1 FROM library_entries e WHERE e.media_id = m.id)) AS extras`.execute(
      db,
    )
  ).rows[0];
  return { files: n(row?.files), bytes: n(row?.bytes) + n(row?.extras) };
}

/** Everything Admin › Stats shows, read now. */
export async function adminStats(db: Kysely<Database>): Promise<AdminStats> {
  const files = await mediaFiles(db);
  return {
    files,
    containers: await containers(db),
    storage: await storage(db, files.bytes),
    people: await people(db),
    unclaimed: await unclaimed(db),
  };
}
