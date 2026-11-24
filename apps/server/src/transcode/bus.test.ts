import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TestValkey } from "../../test/testValkey.ts";
import { createValkey, waitReady } from "../shared/valkey.ts";
import {
  type BusMessage,
  createPlaybackBus,
  forgetSession,
  isAlive,
  isStored,
  markStored,
  type PlaybackBus,
  touchAlive,
  waitForSegment,
} from "./bus.ts";

const logger = pino({ level: "silent" });
const prefix = `t-${randomUUID()}`;
let valkey: Redis;
let bus: PlaybackBus;
let other: PlaybackBus;

beforeAll(async () => {
  valkey = createValkey(TestValkey.url(), "api", logger);
  await waitReady(valkey, 5000);
  bus = createPlaybackBus(createValkey(TestValkey.url(), "worker", logger), valkey, prefix, logger);
  other = createPlaybackBus(
    createValkey(TestValkey.url(), "worker", logger),
    valkey,
    prefix,
    logger,
  );
  await Promise.all([bus.ready, other.ready]);
});
afterAll(async () => {
  bus.close();
  other.close();
  valkey.disconnect();
  await TestValkey.clear(prefix);
});

const keys = () => ({ valkey, prefix });

describe("the playback bus", () => {
  it("carries a message to every replica's listeners", async () => {
    const got = new Promise<BusMessage>((resolve) => {
      const off = other.on((m) => {
        off();
        resolve(m);
      });
    });
    await bus.publish({ t: "want", sid: "s1", n: 4 });
    expect(await got).toEqual({ t: "want", sid: "s1", n: 4 });
  });

  it("remembers which segments are stored, the init as -1", async () => {
    const sid = randomUUID();
    expect(await isStored(keys(), sid, 3)).toBe(false);
    await markStored(keys(), sid, 3);
    await markStored(keys(), sid, -1);
    expect(await isStored(keys(), sid, 3)).toBe(true);
    expect(await isStored(keys(), sid, -1)).toBe(true);
    expect(await isStored(keys(), sid, 2)).toBe(false);
    await forgetSession(keys(), sid);
    expect(await isStored(keys(), sid, 3)).toBe(false);
  });

  it("keeps a session alive for two minutes from its last request", async () => {
    const sid = randomUUID();
    expect(await isAlive(keys(), sid)).toBe(false);
    await touchAlive(keys(), sid);
    expect(await isAlive(keys(), sid)).toBe(true);
    const ttl = await valkey.pttl(`${prefix}:pb:${sid}:alive`);
    // Long enough for a background tab's throttled pings (about one a minute) to keep it.
    expect(ttl).toBeGreaterThan(115_000);
    expect(ttl).toBeLessThanOrEqual(120_000);
  });
});

describe("waitForSegment", () => {
  it("answers at once for a stored segment", async () => {
    const sid = randomUUID();
    await markStored(keys(), sid, 0);
    expect(await waitForSegment({ ...keys(), bus, sid, n: 0, timeoutMs: 50 })).toBe(true);
  });

  it("asks for a missing segment and wakes when another replica stores it", async () => {
    const sid = randomUUID();
    const wants: BusMessage[] = [];
    const off = other.on((m) => {
      if (m.sid === sid) wants.push(m);
      if (m.t === "want" && m.sid === sid) {
        void markStored(keys(), sid, m.n).then(() => other.publish({ t: "ready", sid, n: m.n }));
      }
    });
    const ok = await waitForSegment({ ...keys(), bus, sid, n: 7, timeoutMs: 5000 });
    off();
    expect(ok).toBe(true);
    expect(wants[0]).toEqual({ t: "want", sid, n: 7 });
  });

  it("notices a segment stored without a message, by looking again", async () => {
    const sid = randomUUID();
    setTimeout(() => void markStored(keys(), sid, 2), 100);
    expect(await waitForSegment({ ...keys(), bus, sid, n: 2, timeoutMs: 3000, pollMs: 50 })).toBe(
      true,
    );
  });

  it("gives up after the timeout, or when the request goes away", async () => {
    const sid = randomUUID();
    expect(await waitForSegment({ ...keys(), bus, sid, n: 1, timeoutMs: 100 })).toBe(false);
    const ac = new AbortController();
    setTimeout(() => {
      ac.abort();
    }, 50);
    const started = Date.now();
    expect(
      await waitForSegment({ ...keys(), bus, sid, n: 1, timeoutMs: 5000, signal: ac.signal }),
    ).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("gives up when the session stops", async () => {
    const sid = randomUUID();
    setTimeout(() => void other.publish({ t: "stop", sid }), 100);
    expect(await waitForSegment({ ...keys(), bus, sid, n: 1, timeoutMs: 5000 })).toBe(false);
  });
});

describe("waitForSegment when Valkey misbehaves", () => {
  /** A bus whose publishes fail, counting them. */
  const failingBus = () => {
    const publish = vi.fn(() => Promise.reject(new Error("valkey down")));
    return {
      bus: { ready: Promise.resolve(), publish, on: () => () => undefined, close: () => undefined },
      publish,
    };
  };

  it("survives failed looks and asks as Valkey drops out (no unhandled rejection)", async () => {
    const getbit = vi.fn().mockResolvedValueOnce(0).mockRejectedValue(new Error("valkey down"));
    const { bus: broken } = failingBus();
    const ok = await waitForSegment({
      valkey: { getbit } as unknown as Redis,
      prefix,
      bus: broken,
      sid: "s",
      n: 1,
      timeoutMs: 300,
      pollMs: 50,
    });
    expect(ok).toBe(false);
    expect(getbit.mock.calls.length).toBeGreaterThan(2);
  });

  it("asks again on every look, so a want lost on the way still reaches the runner", async () => {
    const getbit = vi.fn().mockResolvedValue(0);
    const { bus: counting, publish } = failingBus();
    await waitForSegment({
      valkey: { getbit } as unknown as Redis,
      prefix,
      bus: counting,
      sid: "s",
      n: 1,
      timeoutMs: 280,
      pollMs: 50,
    });
    expect(publish.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
