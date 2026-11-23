import type { Kysely } from "kysely";
import type { Database } from "../src/db/schema.ts";

/** Inserts a local user (password hash is a placeholder; tests that sign in use the real hasher). */
export async function insertUser(
  db: Kysely<Database>,
  opts: { username: string; role?: "admin" | "member"; passwordHash?: string },
): Promise<string> {
  const row = await db
    .insertInto("users")
    .values({
      username: opts.username,
      password_hash: opts.passwordHash ?? "unusable",
      display_name: opts.username,
      role: opts.role ?? "member",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
