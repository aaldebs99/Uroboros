import { createServer } from "node:net";
import type { AddressInfo, Socket } from "node:net";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordingLogger } from "../../test/apiConfig.ts";
import { eventually } from "../../test/eventually.ts";
import { withAdmin } from "../../test/pgAdmin.ts";
import { silentProxy } from "../../test/silentProxy.ts";
import { TestDb } from "../../test/testDb.ts";
import { type LeaderGuard, PgLeaderLock } from "./leader.ts";
import { roleKey } from "./lockKeys.ts";

const logger = pino({ level: "silent" });
const KEY = roleKey("TEST_LDR");
const OTHER = roleKey("TEST_OTH");

/** Postgres splits a bigint advisory key into classid (high 32 bits) and objid (low 32 bits). */
const HELD = `
  FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
  WHERE l.locktype = 'advisory' AND l.granted
    AND l.classid::bigint = ($1::bigint >> 32) AND l.objid::bigint = ($1::bigint & 4294967295)
    AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
const HOLDERS = `SELECT l.pid, a.state, a.xact_start::text AS xact_start, a.application_name ${HELD}`;
const TERMINATE = `SELECT pg_terminate_backend(l.pid) ${HELD}`;

interface Holder {
  pid: number;
  state: string;
  xact_start: string | null;
  application_name: string;
}

let testDb: TestDb;
const guards: LeaderGuard[] = [];

beforeEach(async () => {
  testDb = await TestDb.create();
});

afterEach(async () => {
  await Promise.all(guards.splice(0).map((g) => g.release()));
  await testDb.close();
});

const lock = (key = KEY, keepaliveMs?: number) =>
  new PgLeaderLock(testDb.url, key, {
    logger,
    applicationName: "uroboros-test",
    ...(keepaliveMs === undefined ? {} : { keepaliveMs }),
  });

async function win(l: PgLeaderLock): Promise<LeaderGuard> {
  const guard = await l.tryAcquire();
  if (guard === null) throw new Error("a free lock must be won");
  guards.push(guard);
  return guard;
}

const holders = (key = KEY) =>
  withAdmin(testDb.url, async (c) => (await c.query<Holder>(HOLDERS, [key.toString()])).rows);

const terminateHolder = (key = KEY) =>
  withAdmin(testDb.url, async (c) => {
    const killed = await c.query(TERMINATE, [key.toString()]);
    return killed.rowCount;
  });

describe("PgLeaderLock", () => {
  it("lets only one of two lockers win", async () => {
    await win(lock());
    expect(await lock().tryAcquire()).toBeNull();
  });

  it("lets the loser win once the winner releases", async () => {
    const winner = await win(lock());
    await winner.release();
    await win(lock());
  });

  it("marks the guard lost when its backend is terminated, and the lock frees with it", async () => {
    const guard = await win(lock(KEY, 200));
    expect(guard.isLost).toBe(false);
    expect(await terminateHolder()).toBe(1);
    await eventually(
      () => {
        expect(guard.isLost).toBe(true);
      },
      { timeout: 5000, interval: 50 },
    );
    expect(guard.lost.aborted).toBe(true);
    // Another replica takes over once the holder is gone.
    await win(lock());
  });

  it("marks the guard lost when its keepalive ping goes unanswered (a silent server)", async () => {
    const proxy = await silentProxy(testDb.url);
    try {
      const recording = recordingLogger();
      const l = new PgLeaderLock(proxy.url, KEY, { logger: recording.logger, keepaliveMs: 200 });
      const guard = await win(l);
      proxy.silence();
      const start = Date.now();
      await eventually(
        () => {
          expect(guard.isLost).toBe(true);
        },
        { timeout: 2000, interval: 20 },
      );
      // One tick to send the ping, one more for it to time out.
      expect(Date.now() - start).toBeLessThan(1000);
      // The ping noticed it, not a socket event: the proxy keeps both sockets open.
      const reasons = recording.lines
        .filter((line) => line["msg"] === "leader lock connection failed; leadership lost")
        .map((line) => (line["err"] as { message?: string } | undefined)?.message);
      expect(reasons).toEqual(["leader lock ping timed out"]);
    } finally {
      await proxy.close();
    }
  });

  it("keeps the role keys separate", async () => {
    await win(lock(KEY));
    await win(lock(OTHER));
    expect(await lock(KEY).tryAcquire()).toBeNull();
  });

  it("holds its lock outside any transaction, on a connection named :leader", async () => {
    await win(lock());
    const rows = await holders();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("idle");
    expect(rows[0]?.xact_start).toBeNull();
    expect(rows[0]?.application_name).toBe("uroboros-test:leader");
  });

  it("closes the loser's connection at once", async () => {
    await win(lock());
    expect(await lock().tryAcquire()).toBeNull();
    const sessions = await withAdmin(testDb.url, async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stat_activity
         WHERE datname = current_database() AND application_name = 'uroboros-test:leader'`,
      );
      return r.rows[0]?.n;
    });
    expect(sessions).toBe("1");
  });

  it("frees the lock on release and does not report the release as a loss", async () => {
    const guard = await win(lock());
    await guard.release();
    expect(guard.isLost).toBe(false);
    expect(await holders()).toEqual([]);
  });
});

describe("PgLeaderLock against a server that never answers", () => {
  let sockets: Socket[] = [];
  let closed = 0;
  const silent = createServer((socket) => {
    sockets.push(socket);
    // Reads (and ignores) what arrives, so the client's FIN is seen.
    socket.resume();
    socket.on("error", () => undefined);
    socket.on("close", () => {
      closed++;
    });
  });

  afterEach(async () => {
    for (const s of sockets) s.destroy();
    sockets = [];
    await new Promise<void>((resolve) => {
      silent.close(() => {
        resolve();
      });
    });
  });

  it("fails the attempt within its timeout instead of hanging", async () => {
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const { port } = silent.address() as AddressInfo;
    const l = new PgLeaderLock(`postgres://u:p@127.0.0.1:${String(port)}/db`, KEY, {
      logger,
      attemptTimeoutMs: 300,
    });
    const start = Date.now();
    await expect(l.tryAcquire()).rejects.toThrow(/no answer within 300 ms/);
    expect(Date.now() - start).toBeLessThan(2000);
    // The attempt's socket is closed, not left to the silent server.
    expect(sockets).toHaveLength(1);
    await eventually(() => {
      expect(closed).toBe(1);
    });
  });
});
