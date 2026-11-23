import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Kysely } from "kysely";
import { pino } from "pino";
import type { Logger } from "pino";
import pkg from "../../package.json" with { type: "json" };
import { ConfigError, loadConfig } from "../config.ts";
import type { Config } from "../config.ts";
import { createDb } from "../db/kysely.ts";
import type { Database } from "../db/schema.ts";
import { defaultMigrationsDir } from "../migrate/dir.ts";
import { migrateOnStart, startupGraceFromSecs } from "../migrate/onStart.ts";
import type { MigrationOutcome } from "../migrate/runner.ts";
import { createPushService } from "../push/service.ts";
import { LeaderStatus, leadAndRun, PgLeaderLock } from "../shared/leader.ts";
import { URO_LEAD } from "../shared/lockKeys.ts";
import { createValkey, waitReady } from "../shared/valkey.ts";
import { ensureBootstrapAdmin } from "../auth/bootstrap.ts";
import { startClaimsSync } from "../auth/claimsSync.ts";
import { createOidcProvider } from "../auth/oidc/provider.ts";
import { sweeperDuty } from "../auth/sweeper.ts";
import { createApp } from "./app.ts";
import { CLEANUP_MS, drain, settlesWithin } from "./drain.ts";

/** Past the shutdown budget, how long the process waits before exiting on its own. */
const HARD_EXIT_SLACK_MS = 2000;

export interface RunningApi {
  port: number;
  /**
   * Resolves once migrations ran and the database is attached (readiness turns 200); rejects when
   * start-up failed (a broken migration, a database that refused us), and the replica never gets
   * ready.
   */
  attached: Promise<void>;
  /** Whether this replica holds the general leader lock. */
  leader: LeaderStatus;
  /**
   * The longest `close()` may take: the drain grace, then up to `CLEANUP_MS` for the cut
   * connections to close, then up to `CLEANUP_MS` for the pool, Valkey and the leader lock.
   */
  shutdownBudgetMs: number;
  /**
   * Stops accepting connections, gives up leadership, closes idle connections and waits up to
   * `shutdownGraceMs` for in-flight requests. If they outlast it, cuts every connection and
   * rejects (closing the cut connections is itself bounded by `CLEANUP_MS`). The database, Valkey
   * and the leader lock are released within `CLEANUP_MS` either way; a cleanup that overruns it
   * rejects too, so the caller can exit non-zero. All in all within `shutdownBudgetMs`.
   */
  close(): Promise<void>;
}

/** Test seams. */
export interface StartApiOptions {
  /** Adds routes to the app before it listens (a slow route for the shutdown tests). */
  configure?: (app: OpenAPIHono, db: Kysely<Database>) => void;
  /** How often a replica that does not lead tries the lock again (default 5 s). */
  leaderRetryMs?: number;
}

function listen(app: OpenAPIHono, bind: Config["bind"]): Promise<ServerType> {
  return new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: bind.host, port: bind.port }, () => {
      resolve(s);
    });
  });
}

function logMigrations(logger: Logger, { applied, ahead }: MigrationOutcome): void {
  if (ahead.length > 0) {
    logger.warn(
      { ahead },
      "the database is ahead of this build (a rollback?); continuing, as every migration works with the release before it",
    );
  }
  logger.info({ applied }, applied.length > 0 ? "migrations applied" : "schema is up to date");
}

/**
 * Listens at once (liveness answers, readiness says `starting`), then migrates on a dedicated
 * connection, attaches the database and starts the leader loop: Djinn's `serve`. Installs no
 * process handlers; the caller owns shutdown.
 */
export async function startApi(
  config: Config,
  logger: Logger,
  opts: StartApiOptions = {},
): Promise<RunningApi> {
  // The pool connects lazily: nothing touches the database until it is attached.
  const db = createDb(config.databaseUrl, logger);
  const valkey = createValkey(config.valkeyUrl, "api", logger);
  const push = createPushService(config.push, db, logger);
  const oidc =
    config.auth.oidc === null ? undefined : createOidcProvider(config.auth.oidc, { logger });
  let attached = false;
  const app = createApp(
    {
      db,
      valkey,
      version: pkg.version,
      logger,
      push,
      attached: () => attached,
      auth: {
        secureCookies: config.push.publicBaseUrl?.startsWith("https://") ?? false,
        settings: config.auth,
        databaseUrl: config.databaseUrl,
        ...(oidc === undefined ? {} : { oidc }),
      },
    },
    { webDist: config.webDist, bodyLimitBytes: config.bodyLimitBytes },
  );
  opts.configure?.(app, db);
  const server = await listen(app, config.bind);
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : config.bind.port;
  logger.info({ host: config.bind.host, port }, "api listening");

  const stop = new AbortController();
  // Discovery retries in the background; until it succeeds the sign-in button says so.
  oidc?.start(stop.signal);
  const leader = new LeaderStatus();
  let leading: Promise<void> = Promise.resolve();
  const attaching = (async () => {
    const [outcome] = await Promise.all([
      migrateOnStart({
        url: config.databaseUrl,
        dir: config.migrationsDir ?? defaultMigrationsDir(),
        grace: startupGraceFromSecs(config.dbStartupGraceSecs),
        logger,
        signal: stop.signal,
      }),
      // Not fatal if Valkey is down: readiness reports it as degraded.
      waitReady(valkey, 2000),
    ]);
    logMigrations(logger, outcome);
    const bootstrap = config.auth.local.bootstrap;
    if (bootstrap !== null) await ensureBootstrapAdmin(db, bootstrap, logger);
    attached = true;
    logger.info("api ready");
    if (oidc !== undefined) {
      startClaimsSync({ db, provider: oidc, databaseUrl: config.databaseUrl, logger }, stop.signal);
    }
    // The leader sweeps expired sessions and pending sign-ins hourly. Scheduling never needs it:
    // BullMQ's job schedulers already run each repeatable job exactly once.
    leading = leadAndRun({
      lock: new PgLeaderLock(config.databaseUrl, URO_LEAD, { logger }),
      name: "leader",
      work: sweeperDuty(db, logger),
      shutdown: stop.signal,
      ...(opts.leaderRetryMs === undefined ? {} : { retryMs: opts.leaderRetryMs }),
      status: leader,
      logger,
    });
  })();
  // Observed through `attached`; this only keeps an unobserved failure from crashing the process.
  attaching.catch(() => undefined);

  let closing: Promise<void> | undefined;
  const closeOnce = async () => {
    // Stops start-up and the leader loop now, so leadership goes while the drain still runs.
    stop.abort();
    const released = attaching.catch(() => undefined).then(() => leading);
    const drained = await drain(server, config.shutdownGraceMs);
    valkey.disconnect();
    const cleaned = await settlesWithin(Promise.all([released, db.destroy()]), CLEANUP_MS);
    if (!drained) {
      throw new Error(
        `api did not drain within ${String(config.shutdownGraceMs)} ms; connections cut`,
      );
    }
    if (!cleaned) {
      throw new Error(`api cleanup did not finish within ${String(CLEANUP_MS)} ms`);
    }
  };
  return {
    port,
    attached: attaching,
    leader,
    shutdownBudgetMs: config.shutdownGraceMs + 2 * CLEANUP_MS,
    close() {
      closing ??= closeOnce();
      return closing;
    },
  };
}

/** Resolves with the first of SIGTERM or SIGINT; `dispose` removes the listeners. */
function nextSignal(): { signal: Promise<string>; dispose(): void } {
  let settle: (name: string) => void = () => undefined;
  const signal = new Promise<string>((resolve) => {
    settle = resolve;
  });
  const onTerm = () => {
    settle("SIGTERM");
  };
  const onInt = () => {
    settle("SIGINT");
  };
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onInt);
  return {
    signal,
    dispose() {
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
    },
  };
}

export interface RunOptions {
  /** How the process ends when shutdown overruns its budget; tests pass a spy. */
  exit?: (code: number) => void;
  /** Past `shutdownBudgetMs`, how long before `exit(1)` (default 2 s). */
  hardExitSlackMs?: number;
}

/**
 * Waits for SIGTERM or SIGINT, then closes `api`. Resolves 0 once it drained, 1 if the drain
 * timed out or failed, or if start-up failed first (then without waiting for a signal). A
 * shutdown that outlasts the api's budget plus a little ends the process with `exit(1)`, so a
 * hung cleanup never runs into the kubelet's SIGKILL.
 */
export async function runUntilSignal(
  api: RunningApi,
  logger: Logger,
  opts: RunOptions = {},
): Promise<number> {
  const signals = nextSignal();
  const startupFailed = api.attached.then(
    () => new Promise<never>(() => undefined),
    (err: unknown) => ({ err }),
  );
  const first = await Promise.race([signals.signal, startupFailed]);
  signals.dispose();
  if (typeof first !== "string") {
    logger.fatal({ err: first.err }, "startup failed; exiting");
    await api.close().catch(() => undefined);
    return 1;
  }
  logger.info({ signal: first }, "shutting down");
  const exit =
    opts.exit ??
    ((code: number) => {
      process.exit(code);
    });
  const hardExit = setTimeout(
    () => {
      logger.fatal("shutdown overran its budget; exiting");
      exit(1);
    },
    api.shutdownBudgetMs + (opts.hardExitSlackMs ?? HARD_EXIT_SLACK_MS),
  );
  hardExit.unref();
  try {
    await api.close();
    return 0;
  } catch (err) {
    logger.error({ err }, "shutdown failed");
    return 1;
  } finally {
    clearTimeout(hardExit);
  }
}

/**
 * Runs the API until SIGTERM/SIGINT; resolves with the exit code (0 clean, 1 failed start-up or
 * failed or timed-out shutdown, 2 config). bin/api.ts exits the process with it.
 */
export async function main(_argv: string[] = []): Promise<number> {
  const logger = pino({ name: "uroboros-api" });
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.fatal(err.message);
      return 2;
    }
    throw err;
  }
  const api = await startApi(config, logger);
  return runUntilSignal(api, logger);
}
