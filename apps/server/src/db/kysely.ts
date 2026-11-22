import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { pino } from "pino";
import type { Logger } from "pino";
import type { Database } from "./schema.ts";

const CONNECT_TIMEOUT_MS = 2000;

/**
 * Builds a Kysely handle over its own pool. The caller owns it and must `destroy()` it.
 * A pool with no 'error' listener crashes the process when an idle client dies (a Postgres
 * restart or failover), so the listener is always attached; the pool discards the dead client.
 */
export function createDb(url: string, log: Logger = pino({ name: "db" })): Kysely<Database> {
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
  pool.on("error", (err) => {
    log.error({ err }, "idle postgres client error");
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
