import { sql } from "kysely";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cutListeners, nextMessage, testBus } from "../../test/bus.ts";
import { eventually } from "../../test/eventually.ts";
import { TestDb } from "../../test/testDb.ts";
import { createPgBus, MAX_PAYLOAD_BYTES, notify, notifyAll } from "./notifications.ts";
import type { PgBus } from "./notifications.ts";

let t: TestDb;
const buses: PgBus[] = [];
const bus = (opts: Parameters<typeof testBus>[1] = {}) => {
  const b = testBus(t, opts);
  buses.push(b);
  return b;
};

beforeEach(async () => {
  t = await TestDb.create();
});

afterEach(async () => {
  await Promise.all(buses.splice(0).map((b) => b.close()));
  await t.close();
});

/** Collects what arrives on a channel. */
function collect(b: PgBus, channel: Parameters<PgBus["on"]>[0]): string[] {
  const got: string[] = [];
  b.on(channel, (p) => got.push(p));
  return got;
}

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

function stubLogger(): Logger & {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const l = {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => l,
  };
  return l as unknown as Logger & {
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

describe("the notification bus", () => {
  it("delivers a notify to every listener of its channel, in this process and on another bus", async () => {
    const a = bus();
    const b = bus();
    await Promise.all([a.ready, b.ready]);
    const first = collect(a, "uroboros_jobs");
    const second = collect(a, "uroboros_jobs");
    const other = nextMessage(b, "uroboros_jobs");
    const elsewhere = collect(a, "uroboros_cancel");
    await notify(t.db, "uroboros_jobs", "download");
    expect(await other).toBe("download");
    await settle(100);
    expect(first).toEqual(["download"]);
    expect(second).toEqual(["download"]);
    expect(elsewhere).toEqual([]);
  });

  it("delivers only at commit, and nothing after a rollback", async () => {
    const a = bus();
    await a.ready;
    const got = collect(a, "uroboros_downloads");
    await t.db.transaction().execute(async (trx) => {
      await notify(trx, "uroboros_downloads", "committed");
      await settle(200);
      expect(got).toEqual([]);
    });
    await expect(
      t.db.transaction().execute(async (trx) => {
        await notify(trx, "uroboros_downloads", "rolled back");
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");
    await settle();
    expect(got).toEqual(["committed"]);
  });

  it("sends several payloads in one statement, in order, checking each one's size", async () => {
    const a = bus();
    await a.ready;
    const heard: string[] = [];
    a.on("uroboros_playback", (m) => heard.push(m));
    await notifyAll(t.db, "uroboros_playback", ["one", "two", "three"]);
    await eventually(() => {
      expect(heard).toEqual(["one", "two", "three"]);
    });
    await expect(
      notifyAll(t.db, "uroboros_playback", ["fine", "x".repeat(MAX_PAYLOAD_BYTES + 1)]),
    ).rejects.toThrow(/8000/);
    // Nothing of a refused batch went out, and an empty one sends nothing.
    await notifyAll(t.db, "uroboros_playback", []);
    await notify(t.db, "uroboros_playback", "after");
    await eventually(() => {
      expect(heard).toEqual(["one", "two", "three", "after"]);
    });
  });

  it("refuses a payload of 8000 bytes or more", async () => {
    const a = bus();
    await a.ready;
    const message = nextMessage(a, "uroboros_playback");
    await expect(notify(t.db, "uroboros_playback", "x".repeat(8000))).rejects.toThrow(/8000/);
    // Bytes, not characters: 4000 two-byte characters are 8000 bytes.
    await expect(notify(t.db, "uroboros_playback", "é".repeat(4000))).rejects.toThrow(/8000/);
    await notify(t.db, "uroboros_playback", "x".repeat(MAX_PAYLOAD_BYTES));
    expect((await message).length).toBe(MAX_PAYLOAD_BYTES);
  });

  it("reconnects after its connection is cut and tells resync listeners", async () => {
    const a = bus();
    await a.ready;
    const resynced = new Promise<void>((resolve) => {
      a.onResync(resolve);
    });
    expect(await cutListeners(t.db)).toBe(1);
    await resynced;
    const message = nextMessage(a, "uroboros_jobs");
    await notify(t.db, "uroboros_jobs", "after");
    expect(await message).toBe("after");
  });

  it("retries an unreachable server and stops on close", async () => {
    const logger = stubLogger();
    const b = createPgBus("postgres://nobody:nothing@127.0.0.1:1/none", {
      logger,
      firstBackoffMs: 20,
      maxBackoffMs: 40,
    });
    b.start();
    await eventually(() => {
      expect(logger.warn.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    const started = Date.now();
    await b.close();
    expect(Date.now() - started).toBeLessThan(1000);
    const calls = logger.warn.mock.calls.length;
    await settle(200);
    expect(logger.warn.mock.calls.length).toBe(calls);
  });

  it("a throwing listener does not stop the others", async () => {
    const logger = stubLogger();
    const a = bus({ logger });
    await a.ready;
    a.on("uroboros_cancel", () => {
      throw new Error("listener broke");
    });
    const message = nextMessage(a, "uroboros_cancel");
    await notify(t.db, "uroboros_cancel", "still heard");
    expect(await message).toBe("still heard");
    expect(logger.error).toHaveBeenCalled();
  });

  it("a notify on the pool never relaxes a caller's transaction", async () => {
    const setting = async (db: typeof t.db) =>
      (await sql<{ synchronous_commit: string }>`SHOW synchronous_commit`.execute(db)).rows[0]
        ?.synchronous_commit;
    // The server's own default, which CI's Postgres sets to off for speed.
    const serverDefault = (
      await sql<{ reset_val: string }>`
        SELECT reset_val FROM pg_settings WHERE name = 'synchronous_commit'
      `.execute(t.db)
    ).rows[0]?.reset_val;
    await notify(t.db, "uroboros_jobs", "on the pool");
    expect(await setting(t.db)).toBe(serverDefault);
    await t.db.transaction().execute(async (trx) => {
      // The caller asks for durable commits, so a relaxation shows whatever the default is.
      await sql`SET LOCAL synchronous_commit TO on`.execute(trx);
      await notify(trx, "uroboros_jobs", "in a transaction");
      expect(await setting(trx)).toBe("on");
    });
  });
});
