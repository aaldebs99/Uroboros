/**
 * Messages between replicas over Postgres LISTEN/NOTIFY (docs/jobs.md): every process keeps
 * one listener connection of its own, outside the pool and never in
 * a transaction, LISTENing on every channel, and fans what it hears out to in-process listeners.
 * A notify is delivered when its transaction commits, to every listening session (this process's
 * own listener included), and never after a rollback. A connection that drops is dialled again
 * with a growing backoff, and resync listeners are told, since whatever was sent in the gap is lost.
 */
import { sql } from "kysely";
import type { Kysely } from "kysely";
import type pg from "pg";
import { pino } from "pino";
import type { Logger } from "pino";
import { sleep, withDeadline } from "../shared/deadline.ts";
import { dedicatedClient, destroyClient } from "./client.ts";
import type { Database } from "./schema.ts";

export const CHANNELS = [
  "uroboros_jobs",
  "uroboros_downloads",
  "uroboros_cancel",
  "uroboros_playback",
] as const;
export type Channel = (typeof CHANNELS)[number];

/** Postgres refuses a payload of 8000 bytes or more (in its default configuration). */
export const MAX_PAYLOAD_BYTES = 7999;
/** The listener connection's `application_name`, as `pg_stat_activity` shows it. */
export const LISTEN_APPLICATION_NAME = "uroboros:listen";

/**
 * Sends `payload` on `channel`. Inside a transaction (`db` is one) it goes out when that commits.
 * On the pool it is its own transaction, committed without waiting for the WAL flush: a message is
 * ephemeral, and the shorter commit holds Postgres's notify lock for less time.
 */
export async function notify(
  db: Kysely<Database>,
  channel: Channel,
  payload: string,
): Promise<void> {
  checkSize(channel, payload);
  await (db.isTransaction
    ? sql`SELECT pg_notify(${channel}, ${payload})`.execute(db)
    : sql`SELECT set_config('synchronous_commit', 'off', true), pg_notify(${channel}, ${payload})`.execute(
        db,
      ));
}

/** Sends several payloads on `channel` in one statement (one transaction on the pool). */
export async function notifyAll(
  db: Kysely<Database>,
  channel: Channel,
  payloads: readonly string[],
): Promise<void> {
  if (payloads.length === 0) return;
  if (payloads.length === 1) {
    await notify(db, channel, payloads[0] ?? "");
    return;
  }
  for (const p of payloads) checkSize(channel, p);
  const relax = db.isTransaction ? sql`` : sql`set_config('synchronous_commit', 'off', true),`;
  await sql`SELECT ${relax} pg_notify(${channel}, p) FROM unnest(${[...payloads]}::text[]) AS p`.execute(
    db,
  );
}

function checkSize(channel: Channel, payload: string): void {
  if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) {
    throw new Error(`a ${channel} message must be shorter than 8000 bytes`);
  }
}

export interface PgBus {
  /** Starts listening (at attach, once the database is migrated). Idempotent. */
  start(): void;
  /** Resolves once the first LISTEN is in place. */
  readonly ready: Promise<void>;
  /** Calls `fn` with every payload on `channel`; returns the unsubscribe. */
  on(channel: Channel, fn: (payload: string) => void): () => void;
  /** Calls `fn` after every reconnect (not the first connect): messages may have been lost. */
  onResync(fn: () => void): () => void;
  /** Stops listening and closes the connection, bounded. Idempotent. */
  close(): Promise<void>;
}

export interface PgBusOptions {
  logger?: Logger;
  applicationName?: string;
  /** How often the connection is pinged, and how long a connect or ping may take. Default 10 s. */
  keepaliveMs?: number;
  /** The first wait before dialling again; it doubles up to `maxBackoffMs`. Default 1 s. */
  firstBackoffMs?: number;
  /** Default 30 s. */
  maxBackoffMs?: number;
}

/** How long `close()` waits for the goodbye before just closing the socket. */
const CLOSE_TIMEOUT_MS = 2000;

export function createPgBus(url: string, opts: PgBusOptions = {}): PgBus {
  return new Bus(url, opts);
}

class Bus implements PgBus {
  readonly ready: Promise<void>;
  readonly #url: string;
  readonly #log: Logger;
  readonly #applicationName: string;
  readonly #keepaliveMs: number;
  readonly #firstBackoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #listeners = new Map<Channel, Set<(payload: string) => void>>();
  readonly #resync = new Set<() => void>();
  readonly #stop = new AbortController();
  #markReady: () => void = () => undefined;
  #running: Promise<void> | undefined;
  #client: pg.Client | undefined;

  constructor(url: string, opts: PgBusOptions) {
    this.#url = url;
    this.#log = opts.logger ?? pino({ name: "notifications" });
    this.#applicationName = opts.applicationName ?? LISTEN_APPLICATION_NAME;
    this.#keepaliveMs = opts.keepaliveMs ?? 10_000;
    this.#firstBackoffMs = opts.firstBackoffMs ?? 1000;
    this.#maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.ready = new Promise((resolve) => {
      this.#markReady = resolve;
    });
  }

  start(): void {
    if (this.#running !== undefined || this.#stop.signal.aborted) return;
    this.#running = this.#run();
  }

  on(channel: Channel, fn: (payload: string) => void): () => void {
    let set = this.#listeners.get(channel);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(channel, set);
    }
    const entry = (payload: string) => {
      fn(payload);
    };
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  onResync(fn: () => void): () => void {
    const entry = () => {
      fn();
    };
    this.#resync.add(entry);
    return () => {
      this.#resync.delete(entry);
    };
  }

  async close(): Promise<void> {
    this.#stop.abort();
    const client = this.#client;
    if (client !== undefined) await closeClient(client);
    await this.#running;
  }

  /** Read through a method: a stop can land during any await. */
  #stopped(): boolean {
    return this.#stop.signal.aborted;
  }

  async #run(): Promise<void> {
    let backoff = this.#firstBackoffMs;
    let connectedBefore = false;
    while (!this.#stopped()) {
      const client = await this.#connect();
      if (client === undefined) {
        if (await sleep(backoff, this.#stop.signal)) return;
        backoff = Math.min(backoff * 2, this.#maxBackoffMs);
        continue;
      }
      backoff = this.#firstBackoffMs;
      if (connectedBefore) this.#emitResync();
      else {
        connectedBefore = true;
        this.#markReady();
      }
      await this.#hold(client.client, client.lost);
      this.#client = undefined;
      if (this.#stopped()) return;
      destroyClient(client.client);
      this.#log.warn("the notification listener lost its connection; dialling again");
      if (await sleep(backoff, this.#stop.signal)) return;
    }
  }

  /** One connection, LISTENing on every channel; undefined (logged) when it can't be had. */
  async #connect(): Promise<{ client: pg.Client; lost: AbortSignal } | undefined> {
    const client = dedicatedClient(this.#url, this.#applicationName);
    const lost = new AbortController();
    client.on("error", (err: Error) => {
      if (!this.#stop.signal.aborted) this.#log.warn({ err }, "notification listener error");
      lost.abort();
    });
    client.on("end", () => {
      lost.abort();
    });
    client.on("notification", (msg) => {
      this.#deliver(msg.channel as Channel, msg.payload ?? "");
    });
    const attempt = (async () => {
      await client.connect();
      await client.query(CHANNELS.map((c) => `LISTEN ${c}`).join("; "));
    })();
    try {
      await withDeadline(attempt, this.#keepaliveMs, "notification listener: no answer");
    } catch (err) {
      attempt.catch(() => undefined);
      destroyClient(client);
      this.#log.warn({ err }, "the notification listener could not connect");
      return undefined;
    }
    this.#client = client;
    if (this.#stop.signal.aborted) {
      await closeClient(client);
      return undefined;
    }
    return { client, lost: lost.signal };
  }

  /** Pings the connection until it is lost or the bus stops. */
  async #hold(client: pg.Client, lost: AbortSignal): Promise<void> {
    const until = AbortSignal.any([lost, this.#stop.signal]);
    while (!(await sleep(this.#keepaliveMs, until))) {
      try {
        await withDeadline(client.query("SELECT 1"), this.#keepaliveMs, "listener ping hung");
      } catch (err) {
        if (!this.#stop.signal.aborted)
          this.#log.warn({ err }, "notification listener ping failed");
        return;
      }
    }
  }

  #deliver(channel: Channel, payload: string): void {
    for (const fn of this.#listeners.get(channel) ?? []) {
      try {
        fn(payload);
      } catch (err) {
        this.#log.error({ err, channel }, "a notification listener failed");
      }
    }
  }

  #emitResync(): void {
    for (const fn of this.#resync) {
      try {
        fn();
      } catch (err) {
        this.#log.error({ err }, "a resync listener failed");
      }
    }
  }
}

/** Ends the connection politely, or just closes the socket when the goodbye hangs. */
async function closeClient(client: pg.Client): Promise<void> {
  try {
    await withDeadline(client.end(), CLOSE_TIMEOUT_MS, "listener goodbye hung");
  } catch {
    destroyClient(client);
  }
}
