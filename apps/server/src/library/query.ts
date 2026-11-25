import {
  LIBRARY_PAGE_SIZE,
  type LibraryEntry,
  type LibraryKind,
  type LibraryPage,
  type LibrarySort,
} from "@uroboros/contract";
import { sql, type Kysely, type RawBuilder, type SelectQueryBuilder } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { channelKey, parseChannelKey } from "./channelKey.ts";
import { linkMatch } from "./linkMatch.ts";
import { originOf, platformName } from "./platform.ts";
import { thumbnailUrl } from "./thumbnailUrl.ts";
import { decodeCursor, encodeCursor, type Cursor } from "./cursor.ts";
import { hitsTable, underSearchTimeout, WORST_TIER } from "./search.ts";
import { matchesFor } from "./searchMatches.ts";
import { searchTerms } from "./searchTerms.ts";

export interface LibraryFilters {
  q?: string | undefined;
  /** A pasted link: the entries of the video it points at. */
  url?: string | undefined;
  channel?: string | undefined;
  source?: string | undefined;
  /** A manual playlist of the caller's. */
  playlist?: string | undefined;
  /** One entry (a shared video's listing). */
  entry?: string | undefined;
  tag?: string | undefined;
  watched?: boolean | undefined;
  /** Only the entries in one of the owner's playlists, of either kind (true), or in none (false). */
  inPlaylist?: boolean | undefined;
  /** Only the entries one of the owner's playlists hides from the library (true), or none hides (false). */
  hidden?: boolean | undefined;
  /** Only the files with a picture (video), or only those without (audio). */
  kind?: LibraryKind | undefined;
  sort?: LibrarySort | undefined;
  cursor?: string | undefined;
  /** Entries per page; `LIBRARY_PAGE_SIZE` when omitted. */
  limit?: number | undefined;
}

interface SortSpec {
  expr: RawBuilder<unknown>;
  /** What the cursor stores, when the ordered value would lose precision in JSON (timestamps). */
  keyExpr?: RawBuilder<unknown>;
  dir: "asc" | "desc";
  /** Casts a cursor key back for comparison. */
  cast: (key: Cursor["key"]) => RawBuilder<unknown>;
}

function sortSpec(sort: LibrarySort): SortSpec {
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
      // The best place a search matched (`h`, docs/library.md "Search"), then the newest; the cursor
      // carries both, the time as Postgres's own microsecond text.
      return {
        expr: sql`ROW(${sql.lit(WORST_TIER)} - h.tier, e.added_at)`,
        keyExpr: sql`(${sql.lit(WORST_TIER)} - h.tier)::text || '|' || e.added_at::text`,
        dir: "desc",
        cast: (k) =>
          sql`ROW(split_part(${k}::text, '|', 1)::integer, split_part(${k}::text, '|', 2)::timestamptz)`,
      };
  }
}

/**
 * `ownerId`'s entries with `viewerId`'s progress (the same person, unless through a share). The
 * profile is a left join: an upload's rendition has none, nor has one whose profile went with its
 * owner's account.
 */
export function base(db: Kysely<Database>, viewerId: string, ownerId: string = viewerId) {
  return db
    .selectFrom("library_entries as e")
    .innerJoin("media as m", "m.id", "e.media_id")
    .innerJoin("renditions as r", "r.id", "e.rendition_id")
    .leftJoin("format_profiles as p", "p.id", "r.profile_id")
    .leftJoin("watch_progress as wp", (j) =>
      j.onRef("wp.media_id", "=", "e.media_id").on("wp.user_id", "=", viewerId),
    )
    .where("e.user_id", "=", ownerId);
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

/** The entries of the video a pasted link points at (`linkMatch`). */
function linkFilter(qb: Base, link: string): Base {
  const match = linkMatch(link);
  return match.kind === "youtube"
    ? qb.where("m.extractor", "=", "youtube").where("m.video_id", "=", match.videoId)
    : qb.where("m.webpage_url", "in", match.urls);
}

/**
 * The entries in one of the owner's playlists (`listed`), or in none: one they made
 * (`playlist_items`), or a YouTube one they have (`user_sources`), which lists videos by extractor
 * and id. With `hiding`, only the playlists that keep their videos out of the library count
 * (docs/library.md "Hidden playlists"). Both lookups are on an index: `playlist_items_entry_idx`
 * and `source_items`' key.
 */
function playlistFilter(qb: Base, listed: boolean, hiding = false): Base {
  return qb.where((eb) => {
    const made = eb
      .selectFrom("playlist_items as pi")
      .innerJoin("playlists as p", "p.id", "pi.playlist_id")
      .select("pi.entry_id")
      .whereRef("pi.entry_id", "=", "e.id");
    const youtube = eb
      .selectFrom("user_sources as us")
      .innerJoin("source_items as si", "si.source_id", "us.source_id")
      .select("si.video_id")
      .whereRef("us.user_id", "=", "e.user_id")
      .whereRef("si.extractor", "=", "m.extractor")
      .whereRef("si.video_id", "=", "m.video_id");
    const inAny = eb.or([
      eb.exists(hiding ? made.where("p.hide_from_library", "=", true) : made),
      eb.exists(hiding ? youtube.where("us.hide_from_library", "=", true) : youtube),
    ]);
    return listed ? inAny : eb.not(inAny);
  });
}

function filtered(qb: Base, f: LibraryFilters): Base {
  let out = qb;
  if (f.url !== undefined) out = linkFilter(out, f.url);
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
  if (f.inPlaylist !== undefined) out = playlistFilter(out, f.inPlaylist);
  if (f.hidden !== undefined) out = playlistFilter(out, f.hidden, true);
  if (f.kind !== undefined)
    out = out.where("r.video_codec", f.kind === "audio" ? "is" : "is not", null);
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

export const dashed = (date: string | null): string | null => {
  const m = date === null ? null : /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  return m === null ? null : `${m[1] ?? ""}-${m[2] ?? ""}-${m[3] ?? ""}`;
};

function chooseSort(f: LibraryFilters, terms: string[] | null): LibrarySort {
  const ordered = f.source !== undefined || f.playlist !== undefined;
  if (f.source !== undefined && f.playlist !== undefined) {
    throw new ApiError("bad_request", "source and playlist cannot be combined");
  }
  if (f.sort === "position" && !ordered) {
    throw new ApiError("bad_request", "sort=position needs a source or a playlist");
  }
  if (f.sort === "relevance" && terms === null)
    throw new ApiError("bad_request", "sort=relevance needs q");
  return f.sort ?? (ordered ? "position" : terms !== null ? "relevance" : "added");
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

/**
 * One page of the caller's library (docs/library.md), or, with `as`, of another person's entries
 * the caller reaches through a share (the share's route checked that, and narrows with `entry`,
 * `playlist` or `source`); those entries carry none of the owner's tags, Keep or subscription.
 */
export async function listLibraryPage(
  db: Kysely<Database>,
  userId: string,
  f: LibraryFilters,
  as?: { ownerId: string },
): Promise<LibraryPage> {
  const terms = f.q === undefined ? null : searchTerms(f.q);
  const sort = chooseSort(f, terms);
  if (as === undefined) await checkPlaylists(db, userId, f);
  const spec = sortSpec(sort);
  const size = f.limit ?? LIBRARY_PAGE_SIZE;
  const cursor = f.cursor === undefined ? null : decodeCursor(f.cursor);
  const read = (tx: Kysely<Database>) => {
    let qb = inPlaylist(filtered(base(tx, userId, as?.ownerId), f), f);
    if (terms !== null) {
      // Only the entries whose media the search found; `h.tier` ranks them.
      qb = qb.innerJoin(hitsTable(as?.ownerId ?? userId, terms).as("h"), (j) =>
        j.onRef("h.media_id", "=", "e.media_id"),
      );
    }
    if (f.entry !== undefined) qb = qb.where("e.id", "=", f.entry);
    if (cursor !== null) {
      const op = spec.dir === "desc" ? sql`<` : sql`>`;
      qb = qb.where(
        sql<boolean>`(${spec.expr}, e.id) ${op} (${spec.cast(cursor.key)}, ${cursor.id}::uuid)`,
      );
    }
    const searched = terms === null ? [] : [sql<number[]>`h.tiers`.as("tiers")];
    return (qb as SelectQueryBuilder<Database, never, object>)
      .select([...ENTRY_COLUMNS, ...searched, (spec.keyExpr ?? spec.expr).as("sort_key")] as never)
      .orderBy(sql`${spec.expr} ${sql.raw(spec.dir)}`)
      .orderBy(sql`e.id ${sql.raw(spec.dir)}`)
      .limit(size + 1)
      .execute()
      .catch(badCursorKey);
  };
  // A search's page also says where each entry matched, under the same bound.
  const pageOf = async (tx: Kysely<Database>) => {
    const typed = (await read(tx)) as unknown as EntryRow[];
    const pageRows = typed.slice(0, size);
    const matches =
      terms === null
        ? null
        : await matchesFor(
            tx,
            terms,
            pageRows.map((r) => ({ media_id: r.media_id, tiers: r.tiers ?? [] })),
          );
    return { typed, pageRows, matches };
  };
  const { typed, pageRows, matches } =
    terms === null ? await pageOf(db) : await underSearchTimeout(db, pageOf);
  const last = pageRows.at(-1);
  return {
    entries: pageRows.map((r) => {
      const entry = toEntry(r, as === undefined);
      return matches === null ? entry : { ...entry, match: matches.get(r.media_id) ?? null };
    }),
    nextCursor:
      typed.length > size && last !== undefined
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
  // Aliased: the item query also selects m.webpage_url itself.
  "m.webpage_url as page_url",
  "m.upload_date",
  "m.duration",
  "m.thumbnail_key",
  "m.preview_key",
  "r.size_bytes",
  "r.container",
  "r.video_codec",
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
  page_url: string | null;
  upload_date: string | null;
  duration: number | null;
  thumbnail_key: string | null;
  preview_key: string | null;
  size_bytes: string;
  container: string | null;
  video_codec: string | null;
  profile_name: string | null;
  position_s: number | null;
  duration_s: number | null;
  watched: boolean | null;
  kept: boolean;
  subscription_id: string | null;
  subscription_title: string | null;
  tags: string[];
  /** With a search: every tier its media matched in (`hitsTable`). */
  tiers?: number[];
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

/** The contract's entry; `own` false blanks what is the owner's alone (tags, Keep, subscription). */
export function toEntry(r: EntryRow, own = true): LibraryEntry {
  return {
    id: r.id,
    mediaId: r.media_id,
    title: r.title ?? r.video_id,
    // The site's own name when it names neither a channel nor an uploader.
    channel: r.channel ?? r.uploader ?? platformName(r.extractor, r.page_url),
    uploadDate: dashed(r.upload_date),
    duration: r.duration,
    thumbnailUrl: thumbnailUrl(`/api/library/${r.id}/thumbnail`, r.thumbnail_key),
    previewUrl: thumbnailUrl(`/api/library/${r.id}/preview`, r.preview_key),
    hasVideo: r.video_codec !== null,
    profileName: r.profile_name,
    origin: originOf(r.extractor),
    sizeBytes: Number(r.size_bytes),
    container: r.container,
    addedAt: r.added_at.toISOString(),
    progress:
      r.position_s === null || r.duration_s === null
        ? null
        : { position: r.position_s, duration: r.duration_s, watched: r.watched ?? false },
    tags: own ? r.tags : [],
    kept: own && r.kept,
    subscription:
      !own || r.subscription_id === null
        ? null
        : { id: r.subscription_id, title: r.subscription_title },
    channelKey: channelKey(r.extractor, r.channel_id, r.channel ?? r.uploader),
  };
}
