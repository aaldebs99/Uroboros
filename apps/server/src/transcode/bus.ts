import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { notify } from "../db/notifications.ts";
import type { PgBus } from "../db/notifications.ts";
import type { Database } from "../db/schema.ts";

/**
 * How replicas talk about playback sessions (docs/transcoding.md): a segment request on one replica
 * asks for a segment the session's runner on another replica has not made (`want`), the runner says
 * when one is stored (`ready`), and a stop reaches the runner (`stop`). Which segments are stored,
 * whether the viewer is still there and which run owns the session are rows any replica can read
 * (`playback_segments`, `playback_live`).
 */
export type BusMessage =
  | { t: "want"; sid: string; n: number }
  | { t: "ready"; sid: string; n: number }
  | { t: "stop"; sid: string };

export interface PlaybackBus {
  /** Settles once the replica's listener is in place. */
  ready: Promise<void>;
  publish(m: BusMessage): Promise<void>;
  /** Listens to every message; returns the unsubscribe. */
  on(listener: (m: BusMessage) => void): () => void;
  close(): void;
}

/**
 * The `uroboros_playback` channel of the replica's listener, fanned out to listeners. A message
 * this replica publishes reaches its own listeners too (the listener hears the pool's notifies).
 */
export function createPlaybackBus(bus: PgBus, db: Kysely<Database>, logger: Logger): PlaybackBus {
  const listeners = new Set<(m: BusMessage) => void>();
  const off = bus.on("uroboros_playback", (text) => {
    let m: BusMessage;
    try {
      m = JSON.parse(text) as BusMessage;
    } catch (err) {
      logger.warn({ err }, "ignoring a malformed playback message");
      return;
    }
    for (const listener of [...listeners]) listener(m);
  });
  return {
    ready: bus.ready,
    async publish(m) {
      await notify(db, "uroboros_playback", JSON.stringify(m));
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      off();
      listeners.clear();
    },
  };
}

export interface SessionKeys {
  db: Kysely<Database>;
}

/**
 * A session is dropped this long after its viewer's last request (or ping): long enough that a
 * background tab, whose timers a browser may slow to about one a minute, keeps its session.
 */
export const ALIVE_MS = 120_000;

/** Pushes the viewer's deadline on; nothing for a session that is gone. */
export async function touchAlive(k: SessionKeys, sid: string): Promise<void> {
  await sql`
    INSERT INTO playback_live (session_id, alive_until)
    SELECT id, now() + make_interval(secs => ${ALIVE_MS / 1000}) FROM playback_sessions WHERE id = ${sid}
    ON CONFLICT (session_id) DO UPDATE SET alive_until = excluded.alive_until`.execute(k.db);
}

export async function isAlive(k: SessionKeys, sid: string): Promise<boolean> {
  const row = await k.db
    .selectFrom("playback_live")
    .select("session_id")
    .where("session_id", "=", sid)
    .where("alive_until", ">", sql<Date>`now()`)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Records segment `n` (the init is -1) as stored, with its size for Admin › Stats; nothing for a
 * session that is gone.
 */
export async function markStored(
  k: SessionKeys,
  sid: string,
  n: number,
  size: number | null = null,
): Promise<void> {
  await sql`
    INSERT INTO playback_segments (session_id, n, size_bytes)
    SELECT id, ${n}::int, ${size}::int FROM playback_sessions WHERE id = ${sid}
    ON CONFLICT DO NOTHING`.execute(k.db);
}

export async function isStored(k: SessionKeys, sid: string, n: number): Promise<boolean> {
  const row = await k.db
    .selectFrom("playback_segments")
    .select("n")
    .where("session_id", "=", sid)
    .where("n", "=", n)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * A new run's token: writes of a run whose token is no longer the latest are dropped. Random, so
 * a crash that empties the table can never hand two runs the same one. Null when the session is
 * gone.
 */
export async function nextRunToken(k: SessionKeys, sid: string): Promise<string | null> {
  const r = await sql<{ run_id: string }>`
    INSERT INTO playback_live (session_id, run_id)
    SELECT id, gen_random_uuid() FROM playback_sessions WHERE id = ${sid}
    ON CONFLICT (session_id) DO UPDATE SET run_id = excluded.run_id
    RETURNING run_id`.execute(k.db);
  return r.rows[0]?.run_id ?? null;
}

export async function runToken(k: SessionKeys, sid: string): Promise<string | null> {
  const r = await sql<{ run_id: string | null }>`
    SELECT run_id FROM playback_live WHERE session_id = ${sid}`.execute(k.db);
  return r.rows[0]?.run_id ?? null;
}

export async function forgetSession(k: SessionKeys, sid: string): Promise<void> {
  await sql`
    WITH live AS (DELETE FROM playback_live WHERE session_id = ${sid})
    DELETE FROM playback_segments WHERE session_id = ${sid}`.execute(k.db);
}

export interface WaitOptions extends SessionKeys {
  bus: PlaybackBus;
  sid: string;
  /** The segment; -1 is the init. */
  n: number;
  timeoutMs: number;
  /** How often to look again, in case a `ready` was missed. */
  pollMs?: number;
  signal?: AbortSignal;
}

/** Whether segment `n` is stored, counting a failed look (the database away) as not yet. */
const looksStored = (o: WaitOptions) => isStored(o, o.sid, o.n).catch(() => false);

/** Asks the runner for the segment; a lost or failed ask is made again on the next look. */
const ask = (o: WaitOptions) => {
  o.bus.publish({ t: "want", sid: o.sid, n: o.n }).catch(() => undefined);
};

/**
 * Waits until segment `n` is stored: at once if it is, otherwise asking the runner for it on every
 * look (a want published while the runner's subscription reconnects, or before a requeued runner
 * listens, is gone). False on the timeout, when the request goes away, or when the session stops.
 * Database errors count as not stored yet, never as a rejection nobody handles.
 */
export async function waitForSegment(o: WaitOptions): Promise<boolean> {
  if (await looksStored(o)) return true;
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      off();
      clearTimeout(timer);
      clearInterval(poll);
      o.signal?.removeEventListener("abort", onAbort);
      resolve(ok);
    };
    const onAbort = () => {
      finish(false);
    };
    const look = () => {
      void looksStored(o).then((stored) => {
        if (stored) finish(true);
      });
    };
    // Listening first, then asking and looking: a `ready` between the two is not lost.
    const off = o.bus.on((m) => {
      if (m.sid !== o.sid) return;
      if (m.t === "stop") finish(false);
      else if (m.t === "ready" && m.n === o.n) finish(true);
    });
    const timer = setTimeout(() => {
      finish(false);
    }, o.timeoutMs);
    const poll = setInterval(() => {
      if (done) return;
      ask(o);
      look();
    }, o.pollMs ?? 2000);
    o.signal?.addEventListener("abort", onAbort, { once: true });
    if (o.signal?.aborted === true) finish(false);
    ask(o);
    look();
  });
}
