import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { pino } from "pino";
import type { Logger } from "pino";
import type { Database } from "./schema.ts";

const CONNECT_TIMEOUT_MS = 2000;
/** The default bound on one query: far above any request's, so it only catches a dead server. */
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
/** TCP keepalive starts probing an idle connection after this long, to notice a vanished peer. */
const KEEPALIVE_DELAY_MS = 10_000;
const QUERY_READ_TIMEOUT = "Query read timeout";

export interface DbOptions {
  /**
   * Client-side bound on each query, in ms (pg's `query_timeout`); 0 turns it off, which the
   * migrate Job does because a migration may legitimately run for minutes. Default 30000.
   */
  queryTimeoutMs?: number;
  /** Pool size; pg's default (10) when unset. */
  max?: number;
}

/**
 * pg gives up on a query at `query_timeout` but keeps the client, whose connection still waits for
 * the answer: put back in the pool, it would hang every later query on it. So a client whose query
 * timed out ends itself before the caller releases it, and the pool, seeing it ending, drops it.
 */
function endOnQueryTimeout(client: pg.PoolClient): void {
  const query = client.query.bind(client) as (...args: unknown[]) => unknown;
  const guarded = (...args: unknown[]): unknown => {
    const result = query(...args);
    if (result instanceof Promise) {
      // A side branch: the caller still gets the rejection, after this has run.
      result.catch((err: unknown) => {
        if (err instanceof Error && err.message === QUERY_READ_TIMEOUT) {
          client.end().catch(() => undefined);
        }
      });
    }
    return result;
  };
  client.query = guarded as typeof client.query;
}

/**
 * Builds a Kysely handle over its own pool. The caller owns it and must `destroy()` it.
 * A pool with no 'error' listener crashes the process when an idle client dies (a Postgres
 * restart or failover), so the listener is always attached; the pool discards the dead client.
 * A server that vanishes without closing the connection is bounded twice: each query by
 * `queryTimeoutMs`, and each idle connection by TCP keepalive.
 */
export function createDb(
  url: string,
  log: Logger = pino({ name: "db" }),
  opts: DbOptions = {},
): Kysely<Database> {
  const pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: KEEPALIVE_DELAY_MS,
    query_timeout: opts.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS,
    ...(opts.max === undefined ? {} : { max: opts.max }),
  });
  pool.on("error", (err) => {
    log.error({ err }, "idle postgres client error");
  });
  pool.on("connect", endOnQueryTimeout);
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
