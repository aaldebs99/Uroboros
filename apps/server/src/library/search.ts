import { sql, type Kysely, type RawBuilder, type Transaction } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { likePattern } from "./searchTerms.ts";

/**
 * Library search (docs/library.md "Search"): every term a substring of one title (with its channel
 * and description), one chapter title, or one caption line run, found through the trigram indexes.
 */

/** Where a search matched, best first; a media's rank is its best. */
export const TIER = { title: 0, channel: 1, chapter: 2, description: 3 } as const;
/** The weakest tier, so `WORST_TIER - tier` ranks the best highest. */
export const WORST_TIER = 3;

/** A search's bound, so a broad one cannot hold a connection (the pool's bound is client-side). */
export const SEARCH_TIMEOUT_MS = 10_000;
const QUERY_CANCELED = "57014";

/** `expr` ILIKE every pattern: one predicate each, which a trigram index can serve (`ALL` cannot). */
const holdsAll = (expr: RawBuilder<unknown>, patterns: string[]) =>
  sql<boolean>`(${sql.join(
    patterns.map((p) => sql`${expr} ILIKE ${p}`),
    sql` AND `,
  )})`;

/**
 * The media of `ownerId`'s entries that hold every term, each with its best tier: a derived table
 * (`media_id`, `tier`) to join. The matches are made first (materialised), through the indexes,
 * and only then kept to the owner's, so the planner never walks a whole library to filter it.
 */
export function hitsTable(
  ownerId: string,
  terms: string[],
): RawBuilder<{ media_id: string; tier: number }> {
  const p = terms.map(likePattern);
  const owned = sql`(m.id IN (SELECT media_id FROM owned)) IS TRUE`;
  const title = sql`coalesce(m.title, '')`;
  const byline = sql`coalesce(m.title, '') || E'\\n' || coalesce(m.channel, m.uploader, '')`;
  return sql`(
    WITH owned AS MATERIALIZED (
      SELECT DISTINCT media_id FROM library_entries WHERE user_id = ${ownerId}
    ),
    meta AS MATERIALIZED (
      SELECT m.id AS media_id,
        CASE WHEN ${holdsAll(title, p)} THEN ${TIER.title}
             WHEN ${holdsAll(byline, p)} THEN ${TIER.channel}
             ELSE ${TIER.description} END AS tier
      FROM media m
      WHERE ${holdsAll(sql`media_search_text(m.title, m.channel, m.uploader, m.description)`, p)}
        AND ${owned}
    ),
    chap AS MATERIALIZED (
      SELECT m.id AS media_id, ${TIER.chapter} AS tier
      FROM media m
      WHERE m.chapters <> '[]'::jsonb
        AND ${holdsAll(sql`media_chapter_text(m.chapters)`, p)}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(m.chapters) c WHERE ${holdsAll(sql`(c ->> 'title')`, p)}
        )
        AND ${owned}
    )
    SELECT media_id, min(tier)::integer AS tier
    FROM (SELECT * FROM meta UNION ALL SELECT * FROM chap) u
    GROUP BY media_id
  )`;
}

/**
 * Runs `fn` in a transaction bounded by `statement_timeout`; a search cut short is 503
 * `unavailable`, asking for more specific words.
 */
export async function underSearchTimeout<T>(
  db: Kysely<Database>,
  fn: (tx: Transaction<Database>) => Promise<T>,
  timeoutMs = SEARCH_TIMEOUT_MS,
): Promise<T> {
  try {
    return await db.transaction().execute(async (tx) => {
      await sql`SET LOCAL statement_timeout = ${sql.raw(String(Math.max(1, Math.floor(timeoutMs))))}`.execute(
        tx,
      );
      return fn(tx);
    });
  } catch (err) {
    if ((err as { code?: string }).code === QUERY_CANCELED) {
      throw new ApiError("unavailable", "the search took too long; try more specific words");
    }
    throw err;
  }
}
