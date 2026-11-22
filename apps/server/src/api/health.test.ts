import { pino } from "pino";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { silentProxy } from "../../test/silentProxy.ts";
import { TestDb } from "../../test/testDb.ts";
import { TestValkey } from "../../test/testValkey.ts";
import { createDb } from "../db/kysely.ts";
import { API_COMMAND_TIMEOUT_MS, createValkey, waitReady } from "../shared/valkey.ts";
import { createApp } from "./app.ts";

const logger = pino({ level: "silent" });
const POOL_SIZE = 2;

let testDb: TestDb;
let valkey: Redis;

beforeAll(async () => {
  testDb = await TestDb.create();
  valkey = createValkey(TestValkey.url(), "api", logger);
  await waitReady(valkey, 5000);
});

afterAll(async () => {
  valkey.disconnect();
  await testDb.close();
});

async function timedHealth(app: ReturnType<typeof createApp>) {
  const start = Date.now();
  const body = (await (await app.request("/api/health")).json()) as { status: string };
  return { status: body.status, ms: Date.now() - start };
}

describe("a database that goes silent after the handshake", () => {
  it("frees the hung clients, keeps health bounded, and recovers on new connections", async () => {
    const proxy = await silentProxy(testDb.url);
    const db = createDb(proxy.url, logger, { queryTimeoutMs: 500, max: POOL_SIZE });
    try {
      const app = createApp({ db, valkey, version: "t", logger }, { webDist: null });
      // Both pool clients connect through the proxy and are idle in the pool.
      const warm = await Promise.all([timedHealth(app), timedHealth(app)]);
      expect(warm.map((r) => r.status)).toEqual(["ok", "ok"]);

      proxy.silence();
      // More requests than the pool has clients, twice over: each still answers within bounds.
      for (let round = 0; round < 2; round++) {
        const results = await Promise.all(
          Array.from({ length: POOL_SIZE * 2 }, () => timedHealth(app)),
        );
        for (const r of results) {
          expect(r.status).toBe("degraded");
          expect(r.ms).toBeLessThan(3000);
        }
      }

      // Postgres is reachable again on new connections, but the muted ones never answer. Health
      // is ok again only if the hung clients were released and dropped, not kept in the pool.
      proxy.resume();
      await vi.waitFor(
        async () => {
          expect((await timedHealth(app)).status).toBe("ok");
        },
        { timeout: 10_000, interval: 250 },
      );
    } finally {
      await db.destroy();
      await proxy.close();
    }
  });
});

describe("a valkey that goes silent after the handshake", () => {
  it("times the api client's commands out instead of queueing them forever", async () => {
    const proxy = await silentProxy(TestValkey.url());
    const client = createValkey(proxy.url, "api", logger);
    try {
      expect(await waitReady(client, 5000)).toBe(true);
      proxy.silence();
      const start = Date.now();
      await expect(client.ping()).rejects.toThrow(/timed out/i);
      expect(Date.now() - start).toBeLessThan(API_COMMAND_TIMEOUT_MS + 1000);
    } finally {
      client.disconnect();
      await proxy.close();
    }
  });
});
