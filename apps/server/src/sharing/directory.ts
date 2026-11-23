import type { Directory } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/**
 * Who the caller can share with: every other enabled account (name, and username or email), and
 * the sign-in provider's groups that enabled accounts are in, with their sizes.
 */
export async function listDirectory(db: Kysely<Database>, userId: string): Promise<Directory> {
  const [users, groups] = await Promise.all([
    db
      .selectFrom("users")
      .select([
        "id",
        "display_name as name",
        sql<string | null>`coalesce(username, email)`.as("handle"),
      ])
      .where("disabled_at", "is", null)
      .where("id", "<>", userId)
      .orderBy("display_name")
      .execute(),
    sql<{ name: string; members: string }>`
      SELECT g AS name, count(*) AS members
      FROM users u, jsonb_array_elements_text(u.groups) AS g
      WHERE u.disabled_at IS NULL
      GROUP BY g ORDER BY g`.execute(db),
  ]);
  return { users, groups: groups.rows.map((g) => ({ name: g.name, members: Number(g.members) })) };
}
