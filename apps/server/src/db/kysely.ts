import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./schema.ts";

/** Builds a Kysely handle over its own pool. The caller owns it and must `destroy()` it. */
export function createDb(url: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url }) }),
  });
}
