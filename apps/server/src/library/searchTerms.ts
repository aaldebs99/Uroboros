import { SEARCH_MAX_CHARS, SEARCH_MAX_TERMS, SEARCH_MIN_CHARS } from "@uroboros/contract";
import { ApiError } from "../api/errors.ts";

/** A word, or a "quoted phrase" (an unclosed quote runs to the end). */
const TOKEN = /"([^"]*)"?|([^\s"]+)/g;
/** What a trigram index can find: three letters or digits in a row. */
const SEARCHABLE = /[\p{L}\p{N}]{3}/u;

/**
 * The terms of a library search (docs/library.md "Search"): the words and quoted phrases of `q`,
 * each matched as a substring, every one required. Null when `q` holds nothing but spaces; 400 when
 * the trigram indexes could not search it, or it is too long.
 */
export function searchTerms(q: string): string[] | null {
  const text = q.trim();
  if (text === "") return null;
  const chars = Array.from(text).length;
  if (chars < SEARCH_MIN_CHARS) {
    throw new ApiError("bad_request", `search for at least ${String(SEARCH_MIN_CHARS)} characters`);
  }
  if (chars > SEARCH_MAX_CHARS) {
    throw new ApiError("bad_request", `search for at most ${String(SEARCH_MAX_CHARS)} characters`);
  }
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const term = (m[1] ?? m[2] ?? "").replace(/\s+/g, " ").trim();
    const key = term.toLowerCase();
    if (term === "" || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  if (terms.length > SEARCH_MAX_TERMS) {
    throw new ApiError(
      "bad_request",
      `search for at most ${String(SEARCH_MAX_TERMS)} words or quoted phrases`,
    );
  }
  if (!terms.some((t) => SEARCHABLE.test(t))) {
    throw new ApiError("bad_request", "search for a word of at least 3 letters or digits");
  }
  return terms;
}

/** An ILIKE pattern finding `term` anywhere, its `\`, `%` and `_` taken literally. */
export const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
