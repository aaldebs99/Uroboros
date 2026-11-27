import { sql, type Kysely, type RawBuilder, type Transaction } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { eff } from "./edits.ts";
import { likePattern } from "./searchTerms.ts";

/**
 * Library search (docs/library.md "Search"): every term a substring of one title (with its channel
 * and description), one chapter title, or one caption line run, found through the trigram indexes.
 */

/** Where a search matched, best first; a media's rank is its best. */
export const TIER = { title: 0, channel: 1, chapter: 2, description: 3, captions: 4 } as const;
/** The weakest tier, so `WORST_TIER - tier` ranks the best highest. */
export const WORST_TIER = 4;

/** A search's bound, so a broad one cannot hold a connection (the pool's bound is client-side). */
export const SEARCH_TIMEOUT_MS = 10_000;
const QUERY_CANCELED = "57014";

/** `expr` ILIKE every pattern: one predicate each, which a trigram index can serve (`ALL` cannot). */
const holdsAll = (expr: RawBuilder<unknown>, patterns: string[]) =>
  sql<boolean>`(${sql.join(
    patterns.map((p) => sql`${expr} ILIKE ${p}`),
    sql` AND `,
  )})`;

/** Where a video's title (`title`) and byline (`channel`) put a match: the title, else the channel, else the description. */
function tierOf(title: RawBuilder<unknown>, channel: RawBuilder<unknown>, p: string[]) {
  const t = sql`coalesce(${title}, '')`;
  const byline = sql`${t} || E'\\n' || coalesce(${channel}, '')`;
  return sql<number>`CASE WHEN ${holdsAll(t, p)} THEN ${sql.lit(TIER.title)}
    WHEN ${holdsAll(byline, p)} THEN ${sql.lit(TIER.channel)}
    ELSE ${sql.lit(TIER.description)} END`;
}

/**
 * The media of `ownerId`'s entries that hold every term, each with its best tier and every tier it
 * matched in: a derived table (`media_id`, `tier`, `tiers`) to join. The matches are made first (materialised), through the indexes,
 * and only then kept to the owner's, so the planner never walks a whole library to filter it.
 * A video the owner gave details of their own (docs/library.md#your-own-details) is matched on
 * those instead, outside the index: one person's edits are few.
 */
export function hitsTable(
  ownerId: string,
  terms: string[],
): RawBuilder<{ media_id: string; tier: number; tiers: number[] }> {
  const p = terms.map(likePattern);
  const owned = sql`(m.id IN (SELECT media_id FROM owned)) IS TRUE`;
  return sql`(
    WITH owned AS MATERIALIZED (
      SELECT DISTINCT media_id FROM library_entries WHERE user_id = ${ownerId}
    ),
    edited AS MATERIALIZED (
      SELECT * FROM media_edits
      WHERE user_id = ${ownerId} AND (media_id IN (SELECT media_id FROM owned)) IS TRUE
    ),
    meta AS MATERIALIZED (
      SELECT m.id AS media_id, ${tierOf(sql`m.title`, sql`coalesce(m.channel, m.uploader)`, p)} AS tier
      FROM media m
      WHERE ${holdsAll(sql`media_search_text(m.title, m.channel, m.uploader, m.description)`, p)}
        AND ${owned}
        AND (m.id IN (SELECT media_id FROM edited)) IS NOT TRUE
      UNION ALL
      SELECT m.id AS media_id, ${tierOf(eff.title, eff.channelName, p)} AS tier
      FROM edited ed JOIN media m ON m.id = ed.media_id
      WHERE ${holdsAll(sql`media_search_text(${eff.title}, ${eff.channel}, m.uploader, ${eff.description})`, p)}
    ),
    chap AS MATERIALIZED (
      SELECT m.id AS media_id, ${sql.lit(TIER.chapter)} AS tier
      FROM media m
      WHERE m.chapters <> '[]'::jsonb
        AND ${holdsAll(sql`media_chapter_text(m.chapters)`, p)}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(m.chapters) c WHERE ${holdsAll(sql`(c ->> 'title')`, p)}
        )
        AND ${owned}
    ),
    caps AS MATERIALIZED (
      SELECT DISTINCT s.media_id, ${sql.lit(TIER.captions)} AS tier
      FROM caption_segments s
      WHERE ${holdsAll(sql`s.text`, p)}
        AND (s.media_id IN (SELECT media_id FROM owned)) IS TRUE
    )
    SELECT media_id, min(tier)::integer AS tier,
      array_agg(DISTINCT tier ORDER BY tier)::integer[] AS tiers
    FROM (SELECT * FROM meta UNION ALL SELECT * FROM chap UNION ALL SELECT * FROM caps) u
    GROUP BY media_id
  )`;
}

/**
 * Searches running on this replica at once. Each holds a pooled connection for up to its bound,
 * and the pool also serves the job consumers, so one past this is refused at once.
 */
export const MAX_CONCURRENT_SEARCHES = 4;
let running = 0;

/**
 * Runs `fn` in a transaction bounded by `statement_timeout`; a search cut short is 503
 * `unavailable`, asking for more specific words, and so is one while `maxConcurrent` others run.
 */
export async function underSearchTimeout<T>(
  db: Kysely<Database>,
  fn: (tx: Transaction<Database>) => Promise<T>,
  opts: { timeoutMs?: number; maxConcurrent?: number } = {},
): Promise<T> {
  if (running >= (opts.maxConcurrent ?? MAX_CONCURRENT_SEARCHES)) {
    throw new ApiError("unavailable", "too many searches at once; try again in a moment");
  }
  running++;
  const ms = Math.max(1, Math.floor(opts.timeoutMs ?? SEARCH_TIMEOUT_MS));
  try {
    return await db.transaction().execute(async (tx) => {
      await sql`SET LOCAL statement_timeout = ${sql.raw(String(ms))}`.execute(tx);
      return fn(tx);
    });
  } catch (err) {
    if ((err as { code?: string }).code === QUERY_CANCELED) {
      throw new ApiError("unavailable", "the search took too long; try more specific words");
    }
    throw err;
  } finally {
    running--;
  }
}
