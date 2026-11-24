import type { LoginSite, SiteLoginBody, SiteLoginView } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { open, seal } from "../secrets/seal.ts";

/**
 * Saved site logins (docs/downloads.md, "Site logins"): one row per person and yt-dlp site, the
 * password sealed under `UROBOROS_SECRETS_KEY`. The routes list, save and remove them here; the
 * jobs open them through `forJobs.ts`.
 */

/** The additional data a login's password is sealed with: its owner and its site. */
export function loginAad(userId: string, site: string): string {
  return `site-login:${userId}:${site}`;
}

interface Row {
  user_id: string;
  site: string;
  username: string;
  password_sealed: Buffer;
  updated_at: Date;
}

/** Whether the row's password still opens; never the password itself. */
function view(key: Buffer | null, row: Row): SiteLoginView {
  const readable =
    key !== null && open(key, row.password_sealed, loginAad(row.user_id, row.site)) !== null;
  return {
    site: row.site as LoginSite,
    username: row.username,
    state: readable ? "ok" : "unreadable",
    updatedAt: row.updated_at.toISOString(),
  };
}

const COLUMNS = ["user_id", "site", "username", "password_sealed", "updated_at"] as const;

export async function listLogins(
  db: Kysely<Database>,
  key: Buffer | null,
  userId: string,
): Promise<SiteLoginView[]> {
  const rows = await db
    .selectFrom("site_logins")
    .select(COLUMNS)
    .where("user_id", "=", userId)
    .orderBy("site")
    .execute();
  return rows.map((row) => view(key, row));
}

/** Saves the person's login for `site`, replacing the one they had. */
export async function saveLogin(
  db: Kysely<Database>,
  key: Buffer,
  userId: string,
  site: LoginSite,
  body: SiteLoginBody,
): Promise<SiteLoginView> {
  const sealed = seal(key, body.password, loginAad(userId, site));
  const row = await db
    .insertInto("site_logins")
    .values({ user_id: userId, site, username: body.username, password_sealed: sealed })
    .onConflict((oc) =>
      oc
        .columns(["user_id", "site"])
        .doUpdateSet({ username: body.username, password_sealed: sealed, updated_at: new Date() }),
    )
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();
  return view(key, row);
}

/** Removes the person's login for `site`; false when there was none. */
export async function deleteLogin(
  db: Kysely<Database>,
  userId: string,
  site: LoginSite,
): Promise<boolean> {
  const res = await db
    .deleteFrom("site_logins")
    .where("user_id", "=", userId)
    .where("site", "=", site)
    .executeTakeFirst();
  return res.numDeletedRows > 0n;
}
