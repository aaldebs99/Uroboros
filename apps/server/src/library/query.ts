import {
  LIBRARY_PAGE_SIZE,
  type LibraryEntry,
  type LibraryPage,
  type LibrarySort,
} from "@uroboros/contract";
import { sql, type Kysely, type RawBuilder, type SelectQueryBuilder } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { channelKey, parseChannelKey } from "./channelKey.ts";
import { decodeCursor, encodeCursor, type Cursor } from "./cursor.ts";

export interface LibraryFilters {
  q?: string | undefined;
  channel?: string | undefined;
  source?: string | undefined;
  /** A manual playlist of the caller's. */
  playlist?: string | undefined;
  tag?: string | undefined;
  watched?: boolean | undefined;
  sort?: LibrarySort | undefined;
  cursor?: string | undefined;
}

interface SortSpec {
  expr: RawBuilder<unknown>;
  /** What the cursor stores, when the ordered value would lose precision in JSON (timestamps). */
  keyExpr?: RawBuilder<unknown>;
  dir: "asc" | "desc";
  /** Casts a cursor key back for comparison. */
  cast: (key: Cursor["key"]) => RawBuilder<unknown>;
}

const queryOf = (q: string) => sql`websearch_to_tsquery('simple', ${q})`;

function sortSpec(sort: LibrarySort, q: string | null): SortSpec {
  switch (sort) {
    case "added":
      // A JS Date keeps milliseconds only; the cursor carries Postgres's own microsecond text.
      return {
        expr: sql`e.added_at`,
        keyExpr: sql`e.added_at::text`,
        dir: "desc",
        cast: (k) => sql`${k}::timestamptz`,
      };
    case "uploaded":
      return { expr: sql`coalesce(m.upload_date, '')`, dir: "desc", cast: (k) => sql`${k}::text` };
    case "title":
      return {
        expr: sql`lower(coalesce(m.title, m.video_id))`,
        dir: "asc",
        cast: (k) => sql`${k}::text`,
      };
    case "duration":
      return {
        expr: sql`coalesce(m.duration, -1)`,
        dir: "desc",
        cast: (k) => sql`${k}::double precision`,
      };
    case "position":
      // `pos` is the playlist's join: `source_items` or `playlist_items`.
      return { expr: sql`pos.position`, dir: "asc", cast: (k) => sql`${k}::integer` };
    case "relevance":
      return {
        expr: sql`ts_rank(m.search, ${queryOf(q ?? "")})::double precision`,
        dir: "desc",
        cast: (k) => sql`${k}::double precision`,
      };
  }
}

export function base(db: Kysely<Database>, userId: string) {
  return db
    .selectFrom("library_entries as e")
    .innerJoin("media as m", "m.id", "e.media_id")
    .innerJoin("renditions as r", "r.id", "e.rendition_id")
    .innerJoin("format_profiles as p", "p.id", "r.profile_id")
    .leftJoin("watch_progress as wp", (j) =>
      j.onRef("wp.media_id", "=", "e.media_id").on("wp.user_id", "=", userId),
    )
    .where("e.user_id", "=", userId);
}

type Base = ReturnType<typeof base>;

function channelFilter(qb: Base, key: string): Base {
  const c = parseChannelKey(key);
  if (c === null) throw new ApiError("bad_request", "not a valid channel key");
  const scoped = qb.where("m.extractor", "=", c.extractor);
  return c.kind === "id"
    ? scoped.where("m.channel_id", "=", c.value)
    : scoped
        .where("m.channel_id", "is", null)
        .where(sql<string>`coalesce(m.channel, m.uploader)`, "=", c.value);
}

function filtered(qb: Base, f: LibraryFilters, q: string | null): Base {
  let out = qb;
  if (q !== null) out = out.where(sql<boolean>`m.search @@ ${queryOf(q)}`);
  if (f.channel !== undefined) out = channelFilter(out, f.channel);
  if (f.tag !== undefined) {
    const tag = f.tag.trim().toLowerCase();
    out = out.where((eb) =>
      eb.exists(
        eb
          .selectFrom("entry_tags as t")
          .select("t.tag")
          .whereRef("t.entry_id", "=", "e.id")
          .where("t.tag", "=", tag),
      ),
    );
  }
  if (f.watched !== undefined)
    out = out.where(sql<boolean>`coalesce(wp.watched, false) = ${f.watched}`);
  return out;
}

async function ownsPlaylist(
  db: Kysely<Database>,
  userId: string,
  playlistId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom("playlists")
    .select("id")
    .where("user_id", "=", userId)
    .where("id", "=", playlistId)
    .executeTakeFirst();
  return row !== undefined;
}

async function ownsSource(
  db: Kysely<Database>,
  userId: string,
  sourceId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom("user_sources")
    .select("source_id")
    .where("user_id", "=", userId)
    .where("source_id", "=", sourceId)
    .executeTakeFirst();
  return row !== undefined;
}

const dashed = (date: string | null): string | null => {
  const m = date === null ? null : /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  return m === null ? null : `${m[1] ?? ""}-${m[2] ?? ""}-${m[3] ?? ""}`;
};

function chooseSort(f: LibraryFilters, q: string | null): LibrarySort {
  const ordered = f.source !== undefined || f.playlist !== undefined;
  if (f.source !== undefined && f.playlist !== undefined) {
    throw new ApiError("bad_request", "source and playlist cannot be combined");
  }
  if (f.sort === "position" && !ordered) {
    throw new ApiError("bad_request", "sort=position needs a source or a playlist");
  }
  if (f.sort === "relevance" && q === null)
    throw new ApiError("bad_request", "sort=relevance needs q");
  return f.sort ?? (ordered ? "position" : q !== null ? "relevance" : "added");
}

/** 404 unless the playlist filter names one of the caller's own. */
async function checkPlaylists(db: Kysely<Database>, userId: string, f: LibraryFilters) {
  if (f.source !== undefined && !(await ownsSource(db, userId, f.source))) {
    throw new ApiError("not_found", "no such playlist");
  }
  if (f.playlist !== undefined && !(await ownsPlaylist(db, userId, f.playlist))) {
    throw new ApiError("not_found", "no such playlist");
  }
}

/** Joins the playlist the filter names as `pos`, keeping only its entries. */
function inPlaylist(qb: Base, f: LibraryFilters): Base {
  const { source, playlist } = f;
  if (source !== undefined) {
    return qb.innerJoin("source_items as pos", (j) =>
      j
        .on("pos.source_id", "=", source)
        .onRef("pos.extractor", "=", "m.extractor")
        .onRef("pos.video_id", "=", "m.video_id"),
    );
  }
  if (playlist !== undefined) {
    return qb.innerJoin("playlist_items as pos", (j) =>
      j.on("pos.playlist_id", "=", playlist).onRef("pos.entry_id", "=", "e.id"),
    );
  }
  return qb;
}

/** One page of the caller's library (docs/library.md). */
export async function listLibraryPage(
  db: Kysely<Database>,
  userId: string,
  f: LibraryFilters,
): Promise<LibraryPage> {
  const q = f.q?.trim() ? f.q.trim().slice(0, 500) : null;
  const sort = chooseSort(f, q);
  await checkPlaylists(db, userId, f);
  const spec = sortSpec(sort, q);
  let qb = inPlaylist(filtered(base(db, userId), f, q), f);
  if (f.cursor !== undefined) {
    const c = decodeCursor(f.cursor);
    const op = spec.dir === "desc" ? sql`<` : sql`>`;
    qb = qb.where(sql<boolean>`(${spec.expr}, e.id) ${op} (${spec.cast(c.key)}, ${c.id}::uuid)`);
  }
  const rows = await (qb as SelectQueryBuilder<Database, never, object>)
    .select([...ENTRY_COLUMNS, (spec.keyExpr ?? spec.expr).as("sort_key")] as never)
    .orderBy(sql`${spec.expr} ${sql.raw(spec.dir)}`)
    .orderBy(sql`e.id ${sql.raw(spec.dir)}`)
    .limit(LIBRARY_PAGE_SIZE + 1)
    .execute()
    .catch(badCursorKey);
  const typed = rows as unknown as EntryRow[];
  const pageRows = typed.slice(0, LIBRARY_PAGE_SIZE);
  const last = pageRows.at(-1);
  return {
    entries: pageRows.map(toEntry),
    nextCursor:
      typed.length > LIBRARY_PAGE_SIZE && last !== undefined
        ? encodeCursor({ key: keyOf(last.sort_key), id: last.id })
        : null,
  };
}

/** The columns `toEntry` needs, on `base`'s aliases. */
export const ENTRY_COLUMNS = [
  "e.id",
  "e.media_id",
  "e.added_at",
  "m.title",
  "m.video_id",
  "m.extractor",
  "m.channel",
  "m.channel_id",
  "m.uploader",
  "m.upload_date",
  "m.duration",
  "m.thumbnail_key",
  "r.size_bytes",
  "r.container",
  "p.name as profile_name",
  "wp.position_s",
  "wp.duration_s",
  "wp.watched",
  "e.kept",
  "e.subscription_id",
  sql<string | null>`(SELECT s.title FROM subscriptions s WHERE s.id = e.subscription_id)`.as(
    "subscription_title",
  ),
  sql<
    string[]
  >`coalesce((SELECT array_agg(t.tag ORDER BY t.tag) FROM entry_tags t WHERE t.entry_id = e.id), '{}')`.as(
    "tags",
  ),
] as const;

export interface EntryRow {
  id: string;
  media_id: string;
  added_at: Date;
  title: string | null;
  video_id: string;
  extractor: string;
  channel: string | null;
  channel_id: string | null;
  uploader: string | null;
  upload_date: string | null;
  duration: number | null;
  thumbnail_key: string | null;
  size_bytes: string;
  container: string | null;
  profile_name: string;
  position_s: number | null;
  duration_s: number | null;
  watched: boolean | null;
  kept: boolean;
  subscription_id: string | null;
  subscription_title: string | null;
  tags: string[];
  sort_key: unknown;
}

/** A hand-made cursor whose key does not cast to the sort's type (22007, 22P02) is 400. */
function badCursorKey(err: unknown): never {
  const code = (err as { code?: string }).code;
  if (code === "22007" || code === "22P02" || code === "22008") {
    throw new ApiError("bad_request", "not a valid cursor");
  }
  throw err;
}

const keyOf = (v: unknown): Cursor["key"] =>
  v instanceof Date ? v.toISOString() : typeof v === "number" || typeof v === "string" ? v : null;

export function toEntry(r: EntryRow): LibraryEntry {
  return {
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
    progress:
      r.position_s === null || r.duration_s === null
        ? null
        : { position: r.position_s, duration: r.duration_s, watched: r.watched ?? false },
    tags: r.tags,
    kept: r.kept,
    subscription:
      r.subscription_id === null ? null : { id: r.subscription_id, title: r.subscription_title },
    channelKey: channelKey(r.extractor, r.channel_id, r.channel ?? r.uploader),
  };
}
