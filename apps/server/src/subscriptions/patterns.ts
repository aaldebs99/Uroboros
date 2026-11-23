import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";

/**
 * Title patterns run in Postgres (`~*`, case-insensitive), never in Node: a backtracking pattern
 * would freeze a replica that also serves HTTP, while Postgres bounds it with a statement timeout.
 */

const INVALID_REGEX = "2201B";
const QUERY_CANCELED = "57014";
export const PATTERN_TIMEOUT_MS = 5000;

/** A title pattern took longer than its time limit. */
export class PatternTimeout extends Error {
  constructor() {
    super("a title pattern took too long");
    this.name = "PatternTimeout";
  }
}

/** Where a bracket expression opened at `start` (`[`) closes, or -1. A leading `]` is literal. */
function bracketEnd(p: string, start: number): number {
  let i = start + 1;
  if (p[i] === "^") i++;
  if (p[i] === "]") i++;
  for (; i < p.length; i++) {
    if (p[i] === "]") return i;
  }
  return -1;
}

/**
 * Postgres's `\b` is a backspace and its word boundary is `\y`, so people's `\b` and `\B` outside a
 * bracket expression become `\y` and `\Y`; everything else is kept as written.
 */
export function normalizePattern(p: string): string {
  let out = "";
  let i = 0;
  while (i < p.length) {
    const ch = p.charAt(i);
    if (ch === "[") {
      const end = bracketEnd(p, i);
      const stop = end === -1 ? p.length : end + 1;
      out += p.slice(i, stop);
      i = stop;
    } else if (ch === "\\" && i + 1 < p.length) {
      const next = p.charAt(i + 1);
      out += next === "b" ? "\\y" : next === "B" ? "\\Y" : `\\${next}`;
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const codeOf = (err: unknown) => (err as { code?: string }).code;

/** Throws `bad_request` naming the problem when Postgres refuses the pattern. */
export async function checkPattern(db: Kysely<Database>, pattern: string): Promise<void> {
  try {
    await sql`SELECT '' ~* ${pattern}`.execute(db);
  } catch (err) {
    if (codeOf(err) !== INVALID_REGEX) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new ApiError("bad_request", `not a valid pattern: ${reason}`);
  }
}

/**
 * Whether each title passes: matches `include` (when set) and not `exclude` (when set). A missing
 * title is the empty string. Runs under `statement_timeout` (the pool's own bound is client-side,
 * which would leave the server running a runaway pattern); a timeout is `PatternTimeout`.
 */
export async function titlesPass(
  db: Kysely<Database>,
  titles: readonly (string | null)[],
  include: string | null,
  exclude: string | null,
  timeoutMs = PATTERN_TIMEOUT_MS,
): Promise<boolean[]> {
  if ((include === null && exclude === null) || titles.length === 0) return titles.map(() => true);
  const ms = Math.max(1, Math.floor(timeoutMs));
  try {
    return await db.transaction().execute(async (tx) => {
      await sql`SET LOCAL statement_timeout = ${sql.raw(String(ms))}`.execute(tx);
      const { rows } = await sql<{ ok: boolean }>`
        SELECT (${include}::text IS NULL OR t ~* ${include}::text)
           AND (${exclude}::text IS NULL OR NOT (t ~* ${exclude}::text)) AS ok
        FROM unnest(${titles.map((x) => x ?? "")}::text[]) WITH ORDINALITY AS u(t, i)
        ORDER BY i`.execute(tx);
      return rows.map((r) => r.ok);
    });
  } catch (err) {
    if (codeOf(err) === QUERY_CANCELED) throw new PatternTimeout();
    throw err;
  }
}
