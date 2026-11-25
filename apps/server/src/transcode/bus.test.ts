import { sql } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testBus } from "../../test/bus.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { createDb } from "../db/kysely.ts";
import type { PgBus } from "../db/notifications.ts";
import {
  type BusMessage,
  createPlaybackBus,
  forgetSession,
  isAlive,
  isStored,
  markStored,
  nextRunToken,
  type PlaybackBus,
  runToken,
  touchAlive,
  waitForSegment,
} from "./bus.ts";
import { insertSession, type StoredPlan } from "./sessions.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let pgA: PgBus;
let pgB: PgBus;
let bus: PlaybackBus;
let other: PlaybackBus;
let entry: { entryId: string; renditionId: string };
let userId: string;

const plan: StoredPlan = {
  mode: "encode",
  quality: "720",
  width: 1280,
  height: 720,
  bitrate: 4_000_000,
  level: 32,
  audio: "aac",
  codecs: ["avc1.640020", "mp4a.40.2"],
  bandwidth: 4_160_000,
  boundaries: "uniform",
  reason: "picked",
  start: 0,
};

beforeAll(async () => {
  t = await TestDb.create();
  pgA = testBus(t);
  pgB = testBus(t);
  bus = createPlaybackBus(pgA, t.db, logger);
  other = createPlaybackBus(pgB, t.db, logger);
  await Promise.all([bus.ready, other.ready]);
  userId = await insertUser(t.db, { username: "bus" });
  entry = await seedEntry(t.db, userId);
});
afterAll(async () => {
  bus.close();
  other.close();
  await Promise.all([pgA.close(), pgB.close()]);
  await t.close();
});

const keys = () => ({ db: t.db });

/** A real session row, which the hot state belongs to. */
async function newSession(): Promise<string> {
  const row = await insertSession(t.db, {
    renditionId: entry.renditionId,
    entryId: entry.entryId,
    viewer: { userId },
    plan,
    boundaries: [0, 6, 9],
  });
  return row.id;
}

describe("the playback bus", () => {
  it("carries a message to every replica's listeners", async () => {
    const got = new Promise<BusMessage>((resolve) => {
      const off = other.on((m) => {
        off();
        resolve(m);
      });
    });
    const sid = await newSession();
    await bus.publish({ t: "want", sid, n: 4 });
    expect(await got).toEqual({ t: "want", sid, n: 4 });
  });

  it("remembers stored segments, the init included, until the session is forgotten", async () => {
    const sid = await newSession();
    expect(await isStored(keys(), sid, 3)).toBe(false);
    await markStored(keys(), sid, 3);
    await markStored(keys(), sid, 3);
    await markStored(keys(), sid, -1);
    expect(await isStored(keys(), sid, 3)).toBe(true);
    expect(await isStored(keys(), sid, -1)).toBe(true);
    expect(await isStored(keys(), sid, 2)).toBe(false);
    await forgetSession(keys(), sid);
    expect(await isStored(keys(), sid, 3)).toBe(false);
  });

  it("records a stored segment's size, for Admin › Stats", async () => {
    const sid = await newSession();
    await markStored(keys(), sid, 0, 1200);
    const row = await keys()
      .db.selectFrom("playback_segments")
      .select("size_bytes")
      .where("session_id", "=", sid)
      .executeTakeFirstOrThrow();
    expect(row.size_bytes).toBe(1200);
  });

  it("keeps a viewer alive for two minutes after their last request", async () => {
    const sid = await newSession();
    expect(await isAlive(keys(), sid)).toBe(false);
    await touchAlive(keys(), sid);
    expect(await isAlive(keys(), sid)).toBe(true);
    const r = await sql<{ left: number }>`
      SELECT EXTRACT(EPOCH FROM alive_until - now())::float8 AS left FROM playback_live
      WHERE session_id = ${sid}`.execute(t.db);
    expect(r.rows[0]?.left).toBeGreaterThan(115);
    expect(r.rows[0]?.left).toBeLessThanOrEqual(120);
    await sql`UPDATE playback_live SET alive_until = now() - interval '1 second'`.execute(t.db);
    expect(await isAlive(keys(), sid)).toBe(false);
  });

  it("hands each run a new token, so an older run's no longer matches", async () => {
    const sid = await newSession();
    const first = await nextRunToken(keys(), sid);
    const second = await nextRunToken(keys(), sid);
    expect(first).not.toBe(second);
    expect(await runToken(keys(), sid)).toBe(second);
  });

  it("drops a session's hot state with its row (an unlogged table may reference a logged one)", async () => {
    const sid = await newSession();
    await touchAlive(keys(), sid);
    await markStored(keys(), sid, 0);
    await nextRunToken(keys(), sid);
    await t.db.deleteFrom("playback_sessions").where("id", "=", sid).execute();
    const left = await sql<{ n: number }>`
      SELECT (SELECT count(*) FROM playback_live WHERE session_id = ${sid})
        + (SELECT count(*) FROM playback_segments WHERE session_id = ${sid}) AS n`.execute(t.db);
    expect(Number(left.rows[0]?.n)).toBe(0);
    // Nothing is recorded for a session that is gone.
    await touchAlive(keys(), sid);
    await markStored(keys(), sid, 1);
    expect(await isAlive(keys(), sid)).toBe(false);
    expect(await nextRunToken(keys(), sid)).toBeNull();
  });
});

describe("waitForSegment", () => {
  it("answers at once for a stored segment", async () => {
    const sid = await newSession();
    await markStored(keys(), sid, 0);
    expect(await waitForSegment({ ...keys(), bus, sid, n: 0, timeoutMs: 50 })).toBe(true);
  });

  it("asks for a missing segment and wakes when another replica stores it", async () => {
    const sid = await newSession();
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
    const sid = await newSession();
    setTimeout(() => void markStored(keys(), sid, 2), 100);
    expect(await waitForSegment({ ...keys(), bus, sid, n: 2, timeoutMs: 3000, pollMs: 50 })).toBe(
      true,
    );
  });

  it("gives up after the timeout, or when the request goes away", async () => {
    const sid = await newSession();
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
    const sid = await newSession();
    // The waiter listens before it asks, so its first want means a stop now reaches it.
    const off = other.on((m) => {
      if (m.t === "want" && m.sid === sid) void other.publish({ t: "stop", sid });
    });
    const started = Date.now();
    const ok = await waitForSegment({ ...keys(), bus, sid, n: 1, timeoutMs: 5000 });
    off();
    expect(ok).toBe(false);
    // The stop ended it, not the 5 s timeout, which also answers false.
    expect(Date.now() - started).toBeLessThan(2500);
  });
});

describe("waitForSegment when the database misbehaves", () => {
  /** A bus whose publishes fail, counting them. */
  const failingBus = () => {
    const publish = vi.fn(() => Promise.reject(new Error("database down")));
    return {
      bus: { ready: Promise.resolve(), publish, on: () => () => undefined, close: () => undefined },
      publish,
    };
  };
  const down = createDb("postgres://nobody:nothing@127.0.0.1:1/none");
  afterAll(async () => {
    await down.destroy();
  });

  it("survives failed looks and asks, and keeps asking (no unhandled rejection)", async () => {
    const { bus: broken, publish } = failingBus();
    const ok = await waitForSegment({
      db: down,
      bus: broken,
      sid: "00000000-0000-4000-8000-000000000000",
      n: 1,
      timeoutMs: 400,
      pollMs: 50,
    });
    expect(ok).toBe(false);
    expect(publish.mock.calls.length).toBeGreaterThan(2);
  });

  it("asks again on every look, so a want lost on the way still reaches the runner", async () => {
    const { bus: counting, publish } = failingBus();
    await waitForSegment({
      db: t.db,
      bus: counting,
      sid: await newSession(),
      n: 1,
      timeoutMs: 280,
      pollMs: 50,
    });
    expect(publish.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
