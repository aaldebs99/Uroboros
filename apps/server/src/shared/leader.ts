/**
 * Leader election on a Postgres advisory lock, ported from Djinn (`djinn-store`'s `leader.rs` and
 * `djinn-server`'s `lead_and_run`). The holder takes a session-level `pg_try_advisory_lock` on a
 * connection of its own, outside every pool and outside any transaction, and pings it; the first
 * failed or hung ping reports the loss. The server drops the lock with the session, so a dead
 * holder frees it without anyone's help, and another replica's next attempt wins.
 */
import type pg from "pg";
import { pino } from "pino";
import type { Logger } from "pino";
import { dedicatedClient, destroyClient } from "../db/client.ts";
import { aborted, sleep, withDeadline } from "./deadline.ts";

/** How often the held connection is pinged, and how long one ping may take. */
export const DEFAULT_KEEPALIVE_MS = 10_000;
/** How long one attempt may take to connect and try the lock. */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;
/** How long a lost leader waits before trying again. */
export const DEFAULT_LEADER_RETRY_MS = 5000;
/** How long `release()` waits for the unlock and the goodbye before it just closes the socket. */
const RELEASE_TIMEOUT_MS = 2000;
/** Suffix of the leader connection's `application_name`. */
const APPLICATION_SUFFIX = ":leader";

/** Held leadership. `lost` aborts when the lock went away without `release()` being called. */
export class LeaderGuard {
  private releasing: Promise<void> | undefined;

  constructor(
    readonly lost: AbortSignal,
    private readonly releaseLock: () => Promise<void>,
  ) {}

  get isLost(): boolean {
    return this.lost.aborted;
  }

  /** Gives the lock up. Idempotent; never rejects. */
  release(): Promise<void> {
    this.releasing ??= this.releaseLock().catch(() => undefined);
    return this.releasing;
  }
}

/** A lock exactly one replica holds at a time. */
export interface LeaderLock {
  /** Tries once: the guard when this replica won, null when another leads. Rejects when the lock store cannot be reached. */
  tryAcquire(): Promise<LeaderGuard | null>;
}

/** Whether this replica leads right now; logs and tests read it. */
export class LeaderStatus {
  #leading = false;
  readonly #listeners: ((leading: boolean) => void)[] = [];

  get leading(): boolean {
    return this.#leading;
  }

  setLeader(leading: boolean): void {
    if (leading === this.#leading) return;
    this.#leading = leading;
    for (const listener of this.#listeners) listener(leading);
  }

  onChange(listener: (leading: boolean) => void): void {
    this.#listeners.push(listener);
  }
}

export interface PgLeaderLockOptions {
  logger?: Logger;
  /** The base `application_name`; the connection is `<base>:leader`. Default "uroboros". */
  applicationName?: string;
  keepaliveMs?: number;
  attemptTimeoutMs?: number;
}

/** One advisory lock key, tried on demand. */
export class PgLeaderLock implements LeaderLock {
  readonly #url: string;
  readonly #key: string;
  readonly #log: Logger;
  readonly #applicationName: string;
  readonly #keepaliveMs: number;
  readonly #attemptTimeoutMs: number;

  constructor(url: string, key: bigint, opts: PgLeaderLockOptions = {}) {
    this.#url = url;
    this.#key = key.toString();
    this.#log = opts.logger ?? pino({ name: "leader" });
    this.#applicationName = `${opts.applicationName ?? "uroboros"}${APPLICATION_SUFFIX}`;
    this.#keepaliveMs = opts.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;
    this.#attemptTimeoutMs = opts.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  }

  async tryAcquire(): Promise<LeaderGuard | null> {
    const client = dedicatedClient(this.#url, this.#applicationName);
    // Errors before the lock is won reach the attempt itself; this only keeps them from crashing.
    client.on("error", () => undefined);
    const attempt = (async () => {
      await client.connect();
      const r = await client.query<{ won: boolean }>(
        "SELECT pg_try_advisory_lock($1::bigint) AS won",
        [this.#key],
      );
      return r.rows[0]?.won === true;
    })();
    let won: boolean;
    try {
      won = await withDeadline(
        attempt,
        this.#attemptTimeoutMs,
        `leader lock: no answer within ${String(this.#attemptTimeoutMs)} ms`,
      );
    } catch (err) {
      // Closing the socket also frees a lock the server granted meanwhile.
      attempt.catch(() => undefined);
      destroyClient(client);
      throw err;
    }
    if (!won) {
      await this.#close(client);
      return null;
    }
    return this.#hold(client);
  }

  /** Owns the locking connection until `release()` or the first failed ping. */
  #hold(client: pg.Client): LeaderGuard {
    const lost = new AbortController();
    let released = false;
    let pinging = false;
    const markLost = (reason: unknown) => {
      if (released || lost.signal.aborted) return;
      this.#log.warn({ err: reason }, "leader lock connection failed; leadership lost");
      clearInterval(keepalive);
      lost.abort();
      destroyClient(client);
    };
    client.on("error", markLost);
    client.on("end", () => {
      markLost(new Error("leader lock connection ended"));
    });
    const keepalive = setInterval(() => {
      if (pinging) return;
      pinging = true;
      withDeadline(client.query("SELECT 1"), this.#keepaliveMs, "leader lock ping timed out")
        .catch(markLost)
        .finally(() => {
          pinging = false;
        });
    }, this.#keepaliveMs);
    keepalive.unref();
    return new LeaderGuard(lost.signal, async () => {
      released = true;
      clearInterval(keepalive);
      if (lost.signal.aborted) return;
      try {
        await withDeadline(
          client.query("SELECT pg_advisory_unlock($1::bigint)", [this.#key]),
          RELEASE_TIMEOUT_MS,
          "leader unlock timed out",
        );
      } catch (err) {
        this.#log.warn({ err }, "leader lock not released cleanly; closing its connection");
      }
      await this.#close(client);
    });
  }

  /** Says goodbye, or just closes the socket when the server does not answer in time. */
  async #close(client: pg.Client): Promise<void> {
    try {
      await withDeadline(client.end(), RELEASE_TIMEOUT_MS, "leader connection close timed out");
    } catch {
      destroyClient(client);
    }
  }
}

export interface LeadAndRunOptions {
  lock: LeaderLock;
  /** Names the loop in logs. */
  name: string;
  /** The leader's duty. Its signal aborts on shutdown or when the lock is lost; it should return then. */
  work: (signal: AbortSignal) => Promise<void>;
  shutdown: AbortSignal;
  retryMs?: number;
  status: LeaderStatus;
  logger: Logger;
}

/** Tries the lock until it wins or shutdown aborts; a win that lands after shutdown is given back. */
async function acquire(opts: LeadAndRunOptions): Promise<LeaderGuard | null | "shutdown"> {
  const attempt = opts.lock.tryAcquire();
  // Removes this attempt's listener from the shutdown signal once the race is decided.
  const settled = new AbortController();
  const outcome = await Promise.race([
    attempt.then(
      (guard) => ({ guard }),
      (err: unknown) => ({ err }),
    ),
    aborted(opts.shutdown, settled.signal).then(() => "shutdown" as const),
  ]).finally(() => {
    settled.abort();
  });
  if (outcome === "shutdown" || opts.shutdown.aborted) {
    void attempt.then(
      (guard) => guard?.release(),
      () => undefined,
    );
    return "shutdown";
  }
  if ("err" in outcome) {
    opts.logger.warn({ err: outcome.err, name: opts.name }, "leader lock unavailable; retrying");
    return null;
  }
  if (outcome.guard === null) opts.logger.debug({ name: opts.name }, "another replica leads");
  return outcome.guard;
}

/** Runs `work` under a signal that aborts on shutdown or on the loss of the lock. */
async function runWhileLeading(
  opts: LeadAndRunOptions,
  guard: LeaderGuard,
): Promise<{ failed: unknown } | null> {
  try {
    await opts.work(AbortSignal.any([opts.shutdown, guard.lost]));
    return null;
  } catch (err) {
    return { failed: err };
  }
}

/**
 * Leads whenever it can, until shutdown: tries the lock every `retryMs`; on a win sets the status,
 * runs `work`, and when the work returns (the lock was lost, or shutdown) releases the lock and
 * tries again. A `work` that fails stops this loop for good, as Djinn's does; the HTTP server
 * keeps serving. Shutdown wins over every wait. Never rejects.
 */
export async function leadAndRun(opts: LeadAndRunOptions): Promise<void> {
  const { name, logger, status, shutdown } = opts;
  const retryMs = opts.retryMs ?? DEFAULT_LEADER_RETRY_MS;
  // A call, not the property: the signal flips while this loop awaits.
  const stopping = () => shutdown.aborted;
  while (!stopping()) {
    const guard = await acquire(opts);
    if (guard === "shutdown") return;
    if (guard === null) {
      await sleep(retryMs, shutdown);
      continue;
    }
    status.setLeader(true);
    logger.info({ name }, "leader acquired");
    const outcome = await runWhileLeading(opts, guard);
    const lost = guard.isLost;
    // Not leading any more, even while the release still waits on a server (up to 4 s).
    status.setLeader(false);
    await guard.release();
    logger.info({ name, lost }, "leader released");
    if (outcome !== null) {
      logger.error(
        { err: outcome.failed, name },
        "leader work failed; it stops for good and the HTTP server keeps running",
      );
      return;
    }
    if (!stopping()) logger.warn({ name }, "leadership lost; the work stopped and will retry");
  }
}

/** A leader duty that does nothing but hold leadership until its signal aborts. */
export function idleDuty(signal: AbortSignal): Promise<void> {
  return aborted(signal);
}
