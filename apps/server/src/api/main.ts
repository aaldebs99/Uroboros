import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import pkg from "../../package.json" with { type: "json" };
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
import { createDownloadQueues } from "../downloads/queues.ts";
import { createEventHub } from "../downloads/sse.ts";
import { createStore } from "../storage/index.ts";
import { DEFAULT_PREFIX } from "../worker/queues.ts";
import type { SharedResources } from "../worker/wiring.ts";
import { ensureBootstrapAdmin } from "../auth/bootstrap.ts";
import { startClaimsSync } from "../auth/claimsSync.ts";
import { createOidcProvider } from "../auth/oidc/provider.ts";
import { sweeperDuty } from "../auth/sweeper.ts";
import { reconcileDuty } from "../downloads/reconcile.ts";
import { automationDuties } from "../subscriptions/duties.ts";
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
  /**
   * Resolves with the error when start-up fails for good: a migration, or job consumers that could
   * not start. Never resolves otherwise.
   */
  crashed: Promise<{ err: unknown }>;
  /** Whether this replica holds the general leader lock. */
  leader: LeaderStatus;
  /**
   * The longest `close()` may take: the longer of the HTTP drain grace and the consumers' grace,
   * then up to `CLEANUP_MS` for the cut connections to close, then up to `CLEANUP_MS` for the
   * pool, Valkey and the leader lock.
   */
  shutdownBudgetMs: number;
  /**
   * Stops accepting connections, gives up leadership, stops the job consumers (which wait for
   * their running jobs up to their own grace, alongside the drain), closes idle connections and
   * waits up to `shutdownGraceMs` for in-flight requests. If they outlast it, cuts every connection and
   * rejects (closing the cut connections is itself bounded by `CLEANUP_MS`). The database, Valkey
   * and the leader lock are released within `CLEANUP_MS` either way; a cleanup that overruns it
   * rejects too, so the caller can exit non-zero. All in all within `shutdownBudgetMs`.
   */
  close(): Promise<void>;
}

/** The job consumers a server runs beside HTTP; `close` waits for running jobs. */
export interface Consumers {
  close(): Promise<void>;
}

export interface StartApiOptions {
  /**
   * The job consumers, started once the database is attached (so no job runs against an older
   * schema), on this process's shared connections. `signal` aborts a start that is still waiting
   * for Valkey. `graceMs` is how long their `close()` may take.
   */
  consumers?: {
    start: (shared: SharedResources, signal: AbortSignal) => Promise<Consumers>;
    graceMs: number;
  };
  /** Test seam: the BullMQ and event key prefix (default "uroboros"). */
  prefix?: string;
  /** Test seam: adds routes to the app before it listens (a slow route for the shutdown tests). */
  configure?: (app: OpenAPIHono, db: Kysely<Database>) => void;
  /** Test seam: how often a replica that does not lead tries the lock again (default 5 s). */
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
  const prefix = opts.prefix ?? DEFAULT_PREFIX;
  // The producers; the consumers (when this process runs them) share the same connection.
  const queues = createDownloadQueues(valkey, prefix);
  const store = createStore(config.storage);
  // One subscription per replica feeds every open download event stream.
  const downloadEvents = createEventHub(
    createValkey(config.valkeyUrl, "worker", logger),
    prefix,
    logger,
  );
  const downloadContext = {
    db,
    valkey,
    prefix,
    queues,
    limits: config.downloads,
    logger,
  };
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
      downloads: downloadContext,
      downloadEvents,
      store,
      transcodeEncoder: config.worker.transcode.encoder,
      secretsKey: config.secretsKey,
    },
    {
      webDist: config.webDist,
      bodyLimitBytes: config.bodyLimitBytes,
      mediaOrigins:
        config.storage.kind === "s3" && config.storage.publicUrl !== null
          ? [new URL(config.storage.publicUrl).origin]
          : [],
      publicBaseUrl: config.push.publicBaseUrl,
    },
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
  let consumers: Promise<Consumers | null> = Promise.resolve(null);
  let crash: (failure: { err: unknown }) => void = () => undefined;
  const crashed = new Promise<{ err: unknown }>((resolve) => {
    crash = resolve;
  });
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
    if (bootstrap?.weak === true) {
      logger.warn(
        { username: bootstrap.username },
        "the bootstrap admin has a weak password (UROBOROS_ALLOW_WEAK_BOOTSTRAP_PASSWORD); local dev stacks only",
      );
    }
    if (bootstrap !== null) await ensureBootstrapAdmin(db, bootstrap, logger);
    attached = true;
    logger.info("api ready");
    if (oidc !== undefined) {
      startClaimsSync({ db, provider: oidc, databaseUrl: config.databaseUrl, logger }, stop.signal);
    }
    // The leader sweeps expired sessions and pending sign-ins hourly, re-adds lost fetch jobs and
    // keeps the subscription schedulers in step. The schedules themselves never need it: BullMQ's
    // job schedulers already run each repeatable job exactly once.
    leading = leadAndRun({
      lock: new PgLeaderLock(config.databaseUrl, URO_LEAD, { logger }),
      name: "leader",
      work: (signal) =>
        Promise.all([
          sweeperDuty(db, logger)(signal),
          reconcileDuty(downloadContext)(signal),
          automationDuties(downloadContext, store, {
            keepDays: config.worker.transcode.keepDays,
          })(signal),
        ]).then(() => undefined),
      shutdown: stop.signal,
      ...(opts.leaderRetryMs === undefined ? {} : { retryMs: opts.leaderRetryMs }),
      status: leader,
      logger,
    });
    const starting = opts.consumers?.start({ db, valkey, queues, store, push }, stop.signal);
    if (starting !== undefined) {
      // In the background: Valkey down delays the consumers, never readiness. A start aborted by
      // shutdown is no crash; any other failure is.
      consumers = starting.catch((err: unknown) => {
        if (!stop.signal.aborted) crash({ err });
        return null;
      });
    }
  })();
  attaching.catch((err: unknown) => {
    crash({ err });
  });

  /** Closes the consumers, if any started; false when their drain failed or overran. */
  const closeConsumers = async (): Promise<boolean> => {
    await attaching.catch(() => undefined);
    const running = await consumers;
    if (running === null) return true;
    try {
      await running.close();
      return true;
    } catch (err) {
      logger.error({ err }, "the job consumers did not drain");
      return false;
    }
  };

  let closing: Promise<void> | undefined;
  const closeOnce = async () => {
    // Stops start-up and the leader loop now, so leadership goes while the drain still runs.
    stop.abort();
    const released = attaching.catch(() => undefined).then(() => leading);
    // Event streams never finish on their own: end them so the drain does not wait them out.
    downloadEvents.close();
    const [drained, consumersClosed] = await Promise.all([
      drain(server, config.shutdownGraceMs),
      closeConsumers(),
    ]);
    await settlesWithin(queues.close(), CLEANUP_MS);
    valkey.disconnect();
    const cleaned = await settlesWithin(Promise.all([released, db.destroy()]), CLEANUP_MS);
    if (!drained) {
      throw new Error(
        `api did not drain within ${String(config.shutdownGraceMs)} ms; connections cut`,
      );
    }
    if (!consumersClosed) {
      throw new Error("the job consumers did not drain in time; their running jobs were requeued");
    }
    if (!cleaned) {
      throw new Error(`api cleanup did not finish within ${String(CLEANUP_MS)} ms`);
    }
  };
  return {
    port,
    attached: attaching,
    crashed,
    leader,
    shutdownBudgetMs:
      Math.max(config.shutdownGraceMs, opts.consumers?.graceMs ?? 0) + 2 * CLEANUP_MS,
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
 * hung cleanup never runs into the container runtime's SIGKILL.
 */
export async function runUntilSignal(
  api: RunningApi,
  logger: Logger,
  opts: RunOptions = {},
): Promise<number> {
  const signals = nextSignal();
  const first = await Promise.race([signals.signal, api.crashed]);
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
