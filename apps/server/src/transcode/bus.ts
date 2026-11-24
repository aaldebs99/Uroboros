import type { Redis } from "ioredis";
import type { Logger } from "pino";

/**
 * How replicas talk about playback sessions (docs/transcoding.md): a segment request on one replica
 * asks for a segment the session's runner on another replica has not made (`want`), the runner says
 * when one is stored (`ready`), and a stop reaches the runner (`stop`). Which segments are stored,
 * and whether the viewer is still there, are Valkey keys any replica can read.
 */
export type BusMessage =
  | { t: "want"; sid: string; n: number }
  | { t: "ready"; sid: string; n: number }
  | { t: "stop"; sid: string };

export interface PlaybackBus {
  /** Settles once the subscription is in place (ioredis renews it after a reconnect). */
  ready: Promise<void>;
  publish(m: BusMessage): Promise<void>;
  /** Listens to every message; returns the unsubscribe. */
  on(listener: (m: BusMessage) => void): () => void;
  close(): void;
}

export const playbackChannel = (prefix: string) => `${prefix}:playback`;

/** One subscription per replica (`subscriber` is its own connection), fanned out to listeners. */
export function createPlaybackBus(
  subscriber: Redis,
  publisher: Redis,
  prefix: string,
  logger: Logger,
): PlaybackBus {
  const listeners = new Set<(m: BusMessage) => void>();
  const channel = playbackChannel(prefix);
  subscriber.on("message", (from: string, text: string) => {
    if (from !== channel) return;
    let m: BusMessage;
    try {
      m = JSON.parse(text) as BusMessage;
    } catch (err) {
      logger.warn({ err }, "ignoring a malformed playback message");
      return;
    }
    for (const listener of [...listeners]) listener(m);
  });
  const ready = subscriber.subscribe(channel).then(
    () => undefined,
    (err: unknown) => {
      logger.warn({ err }, "subscribing to playback messages failed; retrying on reconnect");
    },
  );
  return {
    ready,
    async publish(m) {
      await publisher.publish(channel, JSON.stringify(m));
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
      subscriber.disconnect();
    },
  };
}

export interface SessionKeys {
  valkey: Redis;
  prefix: string;
}

/** A session is dropped this long after its viewer's last request (or ping). */
export const ALIVE_MS = 60_000;
/** The stored-segment map outlives any session. */
const STORED_TTL_S = 12 * 60 * 60;

const key = (k: SessionKeys, sid: string, what: "alive" | "stored" | "token") =>
  `${k.prefix}:pb:${sid}:${what}`;

export async function touchAlive(k: SessionKeys, sid: string): Promise<void> {
  await k.valkey.set(key(k, sid, "alive"), "1", "PX", ALIVE_MS);
}

export async function isAlive(k: SessionKeys, sid: string): Promise<boolean> {
  return (await k.valkey.exists(key(k, sid, "alive"))) === 1;
}

/** Records segment `n` (the init is -1) as stored. */
export async function markStored(k: SessionKeys, sid: string, n: number): Promise<void> {
  await k.valkey
    .multi()
    .setbit(key(k, sid, "stored"), n + 1, 1)
    .expire(key(k, sid, "stored"), STORED_TTL_S)
    .exec();
}

export async function isStored(k: SessionKeys, sid: string, n: number): Promise<boolean> {
  return (await k.valkey.getbit(key(k, sid, "stored"), n + 1)) === 1;
}

/** A new run's token: writes of a run whose token is no longer the latest are dropped. */
export async function nextRunToken(k: SessionKeys, sid: string): Promise<number> {
  const token = await k.valkey.incr(key(k, sid, "token"));
  await k.valkey.expire(key(k, sid, "token"), STORED_TTL_S);
  return token;
}

export async function runToken(k: SessionKeys, sid: string): Promise<number> {
  return Number((await k.valkey.get(key(k, sid, "token"))) ?? 0);
}

export async function forgetSession(k: SessionKeys, sid: string): Promise<void> {
  await k.valkey.del(key(k, sid, "alive"), key(k, sid, "stored"), key(k, sid, "token"));
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

/**
 * Waits until segment `n` is stored: at once if it is, otherwise after asking the runner for it.
 * False on the timeout, when the request goes away, or when the session stops.
 */
export async function waitForSegment(o: WaitOptions): Promise<boolean> {
  if (await isStored(o, o.sid, o.n)) return true;
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
      void isStored(o, o.sid, o.n).then((stored) => {
        if (stored) finish(true);
      });
    }, o.pollMs ?? 2000);
    o.signal?.addEventListener("abort", onAbort, { once: true });
    if (o.signal?.aborted === true) finish(false);
    void o.bus.publish({ t: "want", sid: o.sid, n: o.n });
    void isStored(o, o.sid, o.n).then((stored) => {
      if (stored) finish(true);
    });
  });
}
