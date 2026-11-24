import type { SearchMatch } from "@uroboros/contract";
import { sql, type Kysely, type RawBuilder } from "kysely";
import type { Database } from "../db/schema.ts";
import { TIER } from "./search.ts";
import { likePattern } from "./searchTerms.ts";
import { snippet, startAt } from "./snippet.ts";

/**
 * Where each of a search page's entries matched, beyond its title and channel (docs/library.md
 * "Search"): the first chapter, else the description, else the first caption run that holds every
 * term. Asked of the page's media alone, through their own rows (each predicate is wrapped so the
 * planner reads the media's rows rather than the trigram index's every match).
 */

/** What a page row brings: its media and every tier the search found it in. */
export interface MatchedRow {
  media_id: string;
  tiers: number[];
}

/** `expr` ILIKE every pattern, checked row by row. */
const holdsAll = (expr: RawBuilder<unknown>, patterns: string[]) =>
  sql<boolean>`(${sql.join(
    patterns.map((p) => sql`(${expr} ILIKE ${p}) IS TRUE`),
    sql` AND `,
  )})`;

/** The source to show for a row: the best it matched that the tile doesn't show already. */
function shownTier(tiers: readonly number[]): number | null {
  const shown = [TIER.chapter, TIER.description, TIER.captions] as number[];
  return shown.find((t) => tiers.includes(t)) ?? null;
}

async function chapterMatches(db: Kysely<Database>, ids: string[], p: string[], terms: string[]) {
  if (ids.length === 0) return [];
  const { rows } = await sql<{ media_id: string; start: number | null; title: string }>`
    SELECT DISTINCT ON (m.id) m.id AS media_id, (c.ch ->> 'start')::double precision AS start,
      c.ch ->> 'title' AS title
    FROM media m, jsonb_array_elements(m.chapters) WITH ORDINALITY AS c (ch, o)
    WHERE m.id = ANY(${ids}::uuid[]) AND ${holdsAll(sql`(c.ch ->> 'title')`, p)}
    ORDER BY m.id, c.o`.execute(db);
  return rows.map((r): [string, SearchMatch] => [
    r.media_id,
    { in: "chapter", snippet: snippet(r.title, terms).parts, start: Math.max(0, r.start ?? 0) },
  ]);
}

async function descriptionMatches(db: Kysely<Database>, ids: string[], terms: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .selectFrom("media")
    .select(["id", "description"])
    .where("id", "in", ids)
    .execute();
  return rows.map((r): [string, SearchMatch] => [
    r.id,
    { in: "description", snippet: snippet(r.description ?? "", terms).parts, start: null },
  ]);
}

async function captionMatches(db: Kysely<Database>, ids: string[], p: string[], terms: string[]) {
  if (ids.length === 0) return [];
  const { rows } = await sql<{
    media_id: string;
    text: string;
    line_at: number[];
    line_start: number[];
  }>`
    SELECT DISTINCT ON (s.media_id) s.media_id, s.text, s.line_at, s.line_start
    FROM caption_segments s
    WHERE s.media_id = ANY(${ids}::uuid[]) AND ${holdsAll(sql`s.text`, p)}
    ORDER BY s.media_id, s.start_s, s.subtitle_id, s.seq`.execute(db);
  return rows.map((r): [string, SearchMatch] => {
    const s = snippet(r.text, terms);
    return [
      r.media_id,
      { in: "captions", snippet: s.parts, start: startAt(s.anchor, r.line_at, r.line_start) },
    ];
  });
}

/** Each row's match, by media id; a row that matched only in its title or channel has none. */
export async function matchesFor(
  db: Kysely<Database>,
  terms: string[],
  rows: readonly MatchedRow[],
): Promise<Map<string, SearchMatch>> {
  const p = terms.map(likePattern);
  const byTier = new Map<number, string[]>();
  for (const r of rows) {
    const t = shownTier(r.tiers);
    if (t !== null) byTier.set(t, [...(byTier.get(t) ?? []), r.media_id]);
  }
  const found = await Promise.all([
    chapterMatches(db, byTier.get(TIER.chapter) ?? [], p, terms),
    descriptionMatches(db, byTier.get(TIER.description) ?? [], terms),
    captionMatches(db, byTier.get(TIER.captions) ?? [], p, terms),
  ]);
  return new Map(found.flat());
}
