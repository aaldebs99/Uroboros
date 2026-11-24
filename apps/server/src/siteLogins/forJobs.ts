import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { open } from "../secrets/seal.ts";
import { loginAad } from "./store.ts";

/** An opened login, as the yt-dlp wrapper takes it (`SiteLoginSecret`). */
export interface OpenedLogin {
  site: string;
  username: string;
  password: string;
}

interface Sealed {
  user_id: string;
  site: string;
  username: string;
  password_sealed: Buffer;
}

/**
 * Opens rows in order, keeping the first readable login per site. A row that no longer opens (the
 * key changed) is skipped with a warning that names only its owner and site.
 */
function openFirstPerSite(key: Buffer, rows: readonly Sealed[], logger?: Logger): OpenedLogin[] {
  const bySite = new Map<string, OpenedLogin>();
  for (const row of rows) {
    if (bySite.has(row.site)) continue;
    const password = open(key, row.password_sealed, loginAad(row.user_id, row.site));
    if (password === null) {
      logger?.warn(
        { userId: row.user_id, site: row.site },
        "a saved site login does not open with this UROBOROS_SECRETS_KEY; skipped",
      );
      continue;
    }
    bySite.set(row.site, { site: row.site, username: row.username, password });
  }
  return [...bySite.values()];
}

/** One person's logins, for a run on their behalf (their probe, their subscription's checks). */
export async function loginsOf(
  db: Kysely<Database>,
  key: Buffer | null | undefined,
  userId: string,
  logger?: Logger,
): Promise<OpenedLogin[]> {
  if (key == null) return [];
  const rows = await db
    .selectFrom("site_logins")
    .select(["user_id", "site", "username", "password_sealed"])
    .where("user_id", "=", userId)
    .execute();
  return openFirstPerSite(key, rows, logger);
}

/**
 * The logins for a shared fetch: for each site, the login of the earliest-waiting person on that
 * fetch key who has one. Read right before each attempt, so a retry sees who is waiting then.
 */
export async function loginsForFetch(
  db: Kysely<Database>,
  key: Buffer | null | undefined,
  fetchKey: string,
  logger?: Logger,
): Promise<OpenedLogin[]> {
  if (key == null) return [];
  const rows = await db
    .selectFrom("downloads as d")
    .innerJoin("site_logins as l", "l.user_id", "d.user_id")
    .select(["l.user_id", "l.site", "l.username", "l.password_sealed"])
    .where("d.fetch_key", "=", fetchKey)
    .where("d.state", "in", ["queued", "running"])
    .orderBy("d.created_at")
    .orderBy("d.id")
    .execute();
  return openFirstPerSite(key, rows, logger);
}
