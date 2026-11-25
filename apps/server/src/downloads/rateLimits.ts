import { YtDlpError } from "@uroboros/ytdlp";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/**
 * Sites limiting this server's requests (docs/downloads.md "Rate limits"). A run that a site
 * answers with a rate limit (yt-dlp's `rate_limited`) records a cooldown for the site; every run
 * that would ask the site something checks it first and, while it lasts, goes back to its queue
 * without asking. A cooldown is as long as the site said (`YtDlpError.retryAfterMs`), or else an
 * estimate that doubles with each limit in a row: 1, 2, 4… minutes, up to an hour. `subtitles`
 * holds back only the subtitle requests, which YouTube limits on their own.
 */
export type CooldownScope = "site" | "subtitles";

const FIRST_WAIT_S = 60;
const LONGEST_WAIT_S = 3600;
/** Waiting jobs come back spread over this much past the cooldown, rather than all at once. */
const SPREAD_MS = 15_000;

/** Hosts that are another site's own, keyed under it. */
const ALIASES: Readonly<Record<string, string>> = {
  "youtu.be": "youtube.com",
  "youtube-nocookie.com": "youtube.com",
};

/**
 * The site a link asks, as cooldowns key it: the host, lowercased, without a leading `www.`, `m.`,
 * `mobile.` or `music.`, and a short-link host under its site's (youtu.be is youtube.com). Text
 * that is not a link keys as it is.
 */
export function siteOf(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
  if (host === "") return url;
  const bare = host.replace(/^(?:www|m|mobile|music)\./, "");
  return ALIASES[bare] ?? bare;
}

/** Until when `site` is not to be asked (in `scope`), or null when it may be now. */
export async function activeCooldown(
  db: Kysely<Database>,
  site: string,
  scope: CooldownScope,
): Promise<Date | null> {
  const row = await db
    .selectFrom("site_cooldowns")
    .select("until")
    .where("site", "=", site)
    .where("scope", "=", scope)
    .where("until", ">", sql<Date>`now()`)
    .executeTakeFirst();
  return row?.until ?? null;
}

/**
 * Records that `site` limited a request: one more limit in a row, and a cooldown of `hintMs` (what
 * the site said) or the estimate for that many limits. A cooldown already running longer stands.
 * Returns when it ends.
 */
export async function noteRateLimit(
  db: Kysely<Database>,
  site: string,
  scope: CooldownScope,
  hintMs: number | null,
): Promise<Date> {
  const hint = hintMs === null ? null : hintMs / 1000;
  const wait = (estimate: ReturnType<typeof sql>) =>
    sql`now() + make_interval(secs => coalesce(${hint}::double precision, ${estimate}))`;
  const { rows } = await sql<{ until: Date }>`
    INSERT INTO site_cooldowns AS c (site, scope, until, strikes)
    VALUES (${site}, ${scope}, ${wait(sql`${FIRST_WAIT_S}::double precision`)}, 1)
    ON CONFLICT (site, scope) DO UPDATE SET
      strikes = c.strikes + 1,
      until = greatest(
        c.until,
        ${wait(sql`least(${LONGEST_WAIT_S}, ${FIRST_WAIT_S} * power(2, c.strikes))::double precision`)})
    RETURNING until`.execute(db);
  const until = rows[0]?.until;
  if (until === undefined) throw new Error("the cooldown was not recorded");
  return until;
}

/**
 * A run asked `site` and was answered: the limits in a row are over. Only a cooldown that has run
 * out goes, so a run that began before a fresh limit never lifts it.
 */
export async function clearRateLimit(
  db: Kysely<Database>,
  site: string,
  scope: CooldownScope,
): Promise<void> {
  await db
    .deleteFrom("site_cooldowns")
    .where("site", "=", site)
    .where("scope", "=", scope)
    .where("until", "<=", sql<Date>`now()`)
    .execute();
}

/** How long a job waiting on a cooldown ending at `until` stays out of its queue. */
export function requeueDelay(until: Date): number {
  return Math.max(0, until.getTime() - Date.now()) + Math.floor(Math.random() * SPREAD_MS);
}

/** Whether a run failed because its site is rate-limiting this server. */
export const isRateLimit = (err: unknown): err is YtDlpError =>
  err instanceof YtDlpError && err.kind === "rate_limited";
