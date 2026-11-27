import { YtDlpError } from "@uroboros/ytdlp";
import { sql, type Kysely } from "kysely";
import type { RateLimitSourceValue } from "../db/rateLimitsSchema.ts";
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

/** What a limit held, for the admin's log (`rate_limit_events`, docs/health.md). */
export interface LimitEvent {
  source: RateLimitSourceValue;
  /** yt-dlp's message (its last `ERROR:` line, redacted); kept to `MESSAGE_CHARS`. */
  message: string;
  /** The video's (or subscription's) link and title, when known. */
  url: string | null;
  title: string | null;
  /** The stored video it held, when there is one (subtitles fetched apart, a preview's copy). */
  mediaId?: string | null;
}

/** The longest message the log keeps. */
const MESSAGE_CHARS = 1000;

/** A message as the log keeps it: no NUL (a text column refuses one), at most `MESSAGE_CHARS`. */
const logged = (message: string) => message.replaceAll("\u0000", "").slice(0, MESSAGE_CHARS);

/**
 * Records that `site` limited a request: one more limit in a row, and a cooldown of `hintMs` (what
 * the site said) or the estimate for that many limits. A cooldown already running longer stands.
 * Logs the limit with what it held (`event`) and the cooldown it set, which the site said
 * (`hinted`) only when its own wait is the one that stands. Returns when it ends.
 */
export async function noteRateLimit(
  db: Kysely<Database>,
  site: string,
  scope: CooldownScope,
  hintMs: number | null,
  event: LimitEvent,
): Promise<Date> {
  return (await noteRateLimitLogged(db, site, scope, hintMs, event)).until;
}

/** `noteRateLimit`, answering the logged limit's id too (to name its video once it is stored). */
export async function noteRateLimitLogged(
  db: Kysely<Database>,
  site: string,
  scope: CooldownScope,
  hintMs: number | null,
  event: LimitEvent,
): Promise<{ until: Date; eventId: string }> {
  const hint = hintMs === null ? null : hintMs / 1000;
  const wait = (estimate: ReturnType<typeof sql>) =>
    sql`now() + make_interval(secs => coalesce(${hint}::double precision, ${estimate}))`;
  const { rows } = await sql<{ until: Date; event_id: string }>`
    WITH cooldown AS (
      INSERT INTO site_cooldowns AS c (site, scope, until, strikes)
      VALUES (${site}, ${scope}, ${wait(sql`${FIRST_WAIT_S}::double precision`)}, 1)
      ON CONFLICT (site, scope) DO UPDATE SET
        strikes = c.strikes + 1,
        until = greatest(
          c.until,
          ${wait(sql`least(${LONGEST_WAIT_S}, ${FIRST_WAIT_S} * power(2, c.strikes))::double precision`)})
      RETURNING until, strikes
    ), logged AS (
      INSERT INTO rate_limit_events
        (site, scope, source, message, url, title, media_id, until, hinted, strikes)
      SELECT ${site}, ${scope}, ${event.source}, ${logged(event.message)}, ${event.url},
        ${event.title}, ${event.mediaId ?? null}::uuid, until,
        -- The site's word only when its wait is the one that stands (not a longer one running).
        coalesce(until = now() + make_interval(secs => ${hint}::double precision), false),
        strikes
      FROM cooldown
      RETURNING id
    )
    SELECT until, (SELECT id FROM logged) AS event_id FROM cooldown`.execute(db);
  const row = rows[0];
  if (row === undefined) throw new Error("the cooldown was not recorded");
  return { until: row.until, eventId: row.event_id };
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
