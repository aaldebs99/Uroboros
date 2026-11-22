/**
 * Migrations on api start, ported from Djinn's `prepare_database` and `run_migrations`: connect
 * (retrying a server that is not up yet, within the startup grace), then apply every pending file
 * on a dedicated connection with no statement, lock or client-side query timeout, since a long
 * migration, or the wait for another replica's, must not be cut off. The runner's advisory lock
 * serialises replicas; the later ones find nothing pending. The connection is closed after, so
 * its settings never reach the pool.
 */
import type pg from "pg";
import type { Logger } from "pino";
import { dedicatedClient, destroyClient } from "../db/client.ts";
import { singleClientDb } from "../db/kysely.ts";
import { DeadlineError, sleep, withDeadline } from "../shared/deadline.ts";
import { type MigrationOutcome, runMigrations } from "./runner.ts";

/** How long one connection attempt may take. */
const CONNECT_TIMEOUT_MS = 10_000;
/** Between two connection attempts. */
const RETRY_MS = 2000;
/** How often a long wait for the server is logged again. */
const LOG_EVERY_MS = 60_000;
/** How long the goodbye on the migration connection may take before the socket is just closed. */
const CLOSE_TIMEOUT_MS = 2000;
const APPLICATION_NAME = "uroboros:migrate";

/**
 * How long to keep retrying a server that cannot be reached: `"none"` fails on the first error (a
 * one-shot command, retried by whatever runs it), `{ ms }` retries that long, `"forever"` until
 * it answers.
 */
export type StartupGrace = "none" | "forever" | { ms: number };

/** `UROBOROS_DB_STARTUP_GRACE_SECS`: zero waits forever, anything else that many seconds. */
export function startupGraceFromSecs(secs: number): StartupGrace {
  return secs === 0 ? "forever" : { ms: secs * 1000 };
}

function allowsRetry(grace: StartupGrace, elapsedMs: number): boolean {
  if (grace === "none") return false;
  if (grace === "forever") return true;
  return elapsedMs < grace.ms;
}

/**
 * An unreachable server, which retrying can fix: a socket error (refused, reset, no such host yet,
 * timed out), a connection that never completed, or Postgres saying it cannot take connections
 * yet (57P03: starting up, shutting down, in recovery). A bad password, a missing database or a
 * malformed URL fail at once.
 */
export function retryable(err: unknown): boolean {
  if (err instanceof DeadlineError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  // Node's socket and DNS codes (ECONNREFUSED, EAI_AGAIN...); not its ERR_* argument errors.
  if (typeof code === "string") return code === "57P03" || /^E(?!RR_)[A-Z_]+$/.test(code);
  return err instanceof Error && /^Connection terminated/.test(err.message);
}

/** Thrown when shutdown arrives before the database was ready. */
export class StartupAborted extends Error {
  override readonly name = "StartupAborted";
  constructor() {
    super("startup aborted before the database was ready");
  }
}

export interface MigrateOnStartOptions {
  url: string;
  dir: string;
  grace: StartupGrace;
  logger: Logger;
  /** Shutdown: stops the retries, and closes the connection under a running migration. */
  signal?: AbortSignal;
  /** Between connection attempts; tests shorten it. */
  retryMs?: number;
}

async function connect(opts: MigrateOnStartOptions): Promise<pg.Client> {
  const started = Date.now();
  let attempts = 0;
  let loggedAt: number | null = null;
  for (;;) {
    if (opts.signal?.aborted === true) throw new StartupAborted();
    attempts++;
    const client = dedicatedClient(opts.url, APPLICATION_NAME);
    client.on("error", () => undefined); // reported through the awaited calls
    const connecting = client.connect();
    connecting.catch(() => undefined);
    try {
      await withDeadline(connecting, CONNECT_TIMEOUT_MS, "postgres did not answer the connection");
      return client;
    } catch (err) {
      destroyClient(client);
      if (!retryable(err) || !allowsRetry(opts.grace, Date.now() - started)) throw err;
      if (loggedAt === null || Date.now() - loggedAt >= LOG_EVERY_MS) {
        const until = opts.grace === "forever" ? "until it answers" : "within the startup grace";
        opts.logger.warn(
          { err, attempts, waitedSecs: Math.round((Date.now() - started) / 1000) },
          `postgres not reachable yet; retrying ${until}`,
        );
        loggedAt = Date.now();
      }
      if (await sleep(opts.retryMs ?? RETRY_MS, opts.signal)) throw new StartupAborted();
    }
  }
}

/** Connects within the grace and applies every pending migration; rejects on any failure. */
export async function migrateOnStart(opts: MigrateOnStartOptions): Promise<MigrationOutcome> {
  const client = await connect(opts);
  const onAbort = () => {
    destroyClient(client);
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await client.query("SET statement_timeout = 0");
    await client.query("SET lock_timeout = 0");
    return await runMigrations(singleClientDb(client), opts.dir);
  } catch (err) {
    if (opts.signal?.aborted === true) throw new StartupAborted();
    throw err;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    try {
      await withDeadline(client.end(), CLOSE_TIMEOUT_MS, "closing the migration connection");
    } catch {
      destroyClient(client);
    }
  }
}
