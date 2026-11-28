import { sql, type Kysely, type Selectable } from "kysely";
import type { RateLimitEventsTable } from "../db/rateLimitsSchema.ts";
import type { Database } from "../db/schema.ts";

/**
 * The admin's log of the rate limits sites answered with (docs/health.md): `noteRateLimit` writes
 * it as it records each cooldown; Admin › Health reads the newest; the leader's sweeper keeps a
 * week.
 */

/** How long a limit stays in the log. */
export const RATE_LIMIT_KEEP_DAYS = 7;
/** How many Admin › Health shows. */
export const RATE_LIMIT_PAGE = 100;

export type RateLimitEventRow = Selectable<RateLimitEventsTable>;

/** The newest `limit` limits, newest first. */
export function listRateLimitEvents(
  db: Kysely<Database>,
  limit: number = RATE_LIMIT_PAGE,
): Promise<RateLimitEventRow[]> {
  return db
    .selectFrom("rate_limit_events")
    .selectAll()
    .orderBy("at", "desc")
    .orderBy("id", "desc")
    .limit(limit)
    .execute();
}

/** A stored video's title, as the log names the video a hover preview or subtitles were for. */
export async function mediaTitle(db: Kysely<Database>, mediaId: string): Promise<string | null> {
  const row = await db
    .selectFrom("media")
    .select("title")
    .where("id", "=", mediaId)
    .executeTakeFirst();
  return row?.title ?? null;
}

/** Drops limits older than a week; returns how many went. */
export async function sweepOldRateLimitEvents(db: Kysely<Database>): Promise<number> {
  const r = await db
    .deleteFrom("rate_limit_events")
    .where("at", "<", sql<Date>`now() - make_interval(days => ${RATE_LIMIT_KEEP_DAYS})`)
    .executeTakeFirst();
  return Number(r.numDeletedRows);
}
