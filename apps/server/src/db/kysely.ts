import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { pino } from "pino";
import type { Logger } from "pino";
import { KEEPALIVE_DELAY_MS } from "./client.ts";
import type { Database } from "./schema.ts";

const CONNECT_TIMEOUT_MS = 2000;
/** The default bound on one query: far above any request's, so it only catches a dead server. */
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
const QUERY_READ_TIMEOUT = "Query read timeout";

/** Each handle's pool, for `pingDb`, which needs a raw client to bound one query on its own. */
const pools = new WeakMap<Kysely<Database>, pg.Pool>();

export interface DbOptions {
  /**
   * Client-side bound on each query, in ms (pg's `query_timeout`); 0 turns it off. Default 30000.
   * Migrations never run on a pool: they get a dedicated client with no bound at all.
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
  pool.on("connect", (client) => {
    endOnQueryTimeout(client);
    // The pool listens for errors on idle clients only. A connection that dies under a query
    // rejects the query and then emits 'error' on a client the pool has handed out; unheard, that
    // would crash the process. The pool drops the client when it comes back.
    client.on("error", (err) => {
      log.warn({ err }, "postgres client error");
    });
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  pools.set(db, pool);
  return db;
}

/**
 * `SELECT 1` on a pool client, bounded by `timeoutMs` on its own rather than the pool's
 * `query_timeout`: on a server gone silent the client is ended and dropped at `timeoutMs`, so a
 * probe never keeps a pool client for 30 s. Rejects on failure or timeout.
 */
export async function pingDb(db: Kysely<Database>, timeoutMs: number): Promise<void> {
  const pool = pools.get(db);
  if (pool === undefined) throw new Error("pingDb needs a handle made by createDb");
  const client = await pool.connect();
  // pg reads a per-query `query_timeout` that its typings do not declare.
  const ping: pg.QueryConfig & { query_timeout: number } = {
    text: "SELECT 1",
    query_timeout: timeoutMs,
  };
  try {
    await client.query(ping);
    client.release();
  } catch (err) {
    // Passing the error destroys the client instead of returning it to the pool.
    client.release(err instanceof Error ? err : true);
    throw err;
  }
}

/**
 * A Kysely handle over one dedicated client, for the migration runner: every query, transaction
 * and session lock runs on that client. Destroying the handle leaves the client open; its owner
 * closes it.
 */
export function singleClientDb(client: pg.Client): Kysely<Database> {
  const pooled = Object.assign(client, { release: () => undefined });
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: { connect: () => Promise.resolve(pooled), end: () => Promise.resolve(), options: {} },
    }),
  });
}
