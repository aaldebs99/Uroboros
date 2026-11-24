import type { Directory } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { listGroups } from "../groups/store.ts";

/**
 * Who the caller can share with: every other enabled account (name, and username or email), and
 * the groups the caller is in, each with its enabled members.
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
    listGroups(db, userId),
  ]);
  return { users, groups: groups.map((g) => ({ id: g.id, name: g.name, members: g.members })) };
}
