import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";

const UNIQUE_VIOLATION = "23505";

interface Wanted {
  username: string;
  password: string;
}

/** The hash to store: the current one when it still verifies, else a fresh one. */
async function hashFor(current: string | null, password: string): Promise<string> {
  return current !== null && (await verifyPassword(current, password))
    ? current
    : hashPassword(password);
}

/**
 * Makes the configured bootstrap admin exist, as Djinn does: on every start the flagged account is
 * created or re-seeded (username, password, admin role). With no flagged account, a local account
 * of that name is adopted. Concurrent replicas are tolerated. `disabled_at` is never touched.
 */
export async function ensureBootstrapAdmin(
  db: Kysely<Database>,
  wanted: Wanted,
  log: Logger,
  retry = true,
): Promise<void> {
  const flagged = await db
    .selectFrom("users")
    .select(["id", "username", "password_hash"])
    .where("bootstrap", "=", true)
    .executeTakeFirst();
  const named = await db
    .selectFrom("users")
    .select(["id", "password_hash"])
    .where("username", "=", wanted.username)
    .executeTakeFirst();

  if (flagged !== undefined) {
    if (named !== undefined && named.id !== flagged.id) {
      throw new Error(
        `bootstrap admin: cannot rename to "${wanted.username}", which another account already uses`,
      );
    }
    await db
      .updateTable("users")
      .set({
        username: wanted.username,
        role: "admin",
        password_hash: await hashFor(flagged.password_hash, wanted.password),
      })
      .where("id", "=", flagged.id)
      .execute();
    return;
  }

  try {
    if (named !== undefined) {
      await db
        .updateTable("users")
        .set({
          bootstrap: true,
          role: "admin",
          password_hash: await hashFor(named.password_hash, wanted.password),
        })
        .where("id", "=", named.id)
        .execute();
      log.info({ username: wanted.username }, "bootstrap admin adopted an existing account");
      return;
    }
    await db
      .insertInto("users")
      .values({
        username: wanted.username,
        display_name: wanted.username,
        role: "admin",
        password_hash: await hashPassword(wanted.password),
        bootstrap: true,
      })
      .execute();
    log.info({ username: wanted.username }, "bootstrap admin created");
  } catch (err) {
    // another replica won the race: re-read its row and re-seed it
    if (retry && (err as { code?: string }).code === UNIQUE_VIOLATION) {
      await ensureBootstrapAdmin(db, wanted, log, false);
      return;
    }
    throw err;
  }
}
