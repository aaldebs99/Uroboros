import { sql, type Kysely } from "kysely";
import type { Database } from "../src/db/schema.ts";
import { type CooldownScope, noteRateLimit } from "../src/downloads/rateLimits.ts";

/** Puts `site` in a cooldown as a limit would (a fetch's, logged as such); returns its end. */
export const holdSite = (
  db: Kysely<Database>,
  site: string,
  scope: CooldownScope = "site",
  hintMs: number | null = null,
): Promise<Date> =>
  noteRateLimit(db, site, scope, hintMs, {
    source: "download",
    message: "HTTP Error 429: Too Many Requests",
    url: null,
    title: null,
  });

/** The limits logged for `site`, oldest first. */
export const loggedLimits = (db: Kysely<Database>, site: string) =>
  db
    .selectFrom("rate_limit_events")
    .select([
      "scope",
      "source",
      "message",
      "url",
      "title",
      "media_id",
      "until",
      "hinted",
      "strikes",
    ])
    .where("site", "=", site)
    .orderBy("at")
    .orderBy("strikes")
    .execute();

/** The pushes queued for a person (the `notify` queue's jobs). */
export const queuedPushes = (db: Kysely<Database>, userId: string) =>
  db
    .selectFrom("jobs")
    .select("id")
    .where("queue", "=", "notify")
    .where(sql<boolean>`data->>'userId' = ${userId}`)
    .execute();
