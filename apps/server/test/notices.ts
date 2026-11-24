import type { Kysely } from "kysely";
import type { Database } from "../src/db/schema.ts";

/** A person's filed notices (the bell's list), newest first. */
export async function listedNotices(db: Kysely<Database>, userId: string) {
  return db
    .selectFrom("notices")
    .select(["kind", "title", "body", "path", "tag", "read_at"])
    .where("user_id", "=", userId)
    .orderBy("created_at", "desc")
    .execute();
}
