import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Redis } from "ioredis";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiConfig } from "../../test/apiConfig.ts";
import { withAdmin } from "../../test/pgAdmin.ts";
import { TestDb } from "../../test/testDb.ts";
import { TestValkey } from "../../test/testValkey.ts";
import type { RunningApi } from "../api/main.ts";
import { MIGRATE_KEY_NAME } from "../shared/lockKeys.ts";
import { main, startServer } from "./main.ts";

const logger = pino({ level: "silent" });
const WAIT = { timeout: 15_000, interval: 50 };
const cleanups: (() => Promise<unknown>)[] = [];
let prefix: string;
let redis: Redis;

beforeEach(() => {
  prefix = `test-${randomUUID()}`;
  redis = new Redis(TestValkey.url());
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  redis.disconnect();
});

async function migratedDb(): Promise<string> {
  const db = await TestDb.create();
  cleanups.push(() => db.close());
  return db.url;
}

function track(server: RunningApi): RunningApi {
  cleanups.push(() => server.close().catch(() => undefined));
  return server;
}

const heartbeat = () => `${prefix}:worker:${hostname()}:${String(process.pid)}`;

describe("one server process", () => {
  it("starts its job consumers only once the database is attached, and stops them on close", async () => {
    const url = await migratedDb();
    const server = await withAdmin(url, async (c) => {
      // Another runner holds the migration lock, so this replica cannot attach yet.
      await c.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATE_KEY_NAME]);
      const s = track(await startServer(apiConfig(url), logger, { prefix }));
      await new Promise((r) => setTimeout(r, 300));
      expect(await redis.exists(heartbeat())).toBe(0);
      await c.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATE_KEY_NAME]);
      return s;
    });
    await server.attached;
    await vi.waitFor(async () => {
      expect(await redis.exists(heartbeat())).toBe(1);
    }, WAIT);
    await server.close();
    expect(await redis.exists(heartbeat())).toBe(0);
  });

  it("budgets its shutdown for the longer of the HTTP drain and the consumers' grace", async () => {
    const url = await migratedDb();
    const server = track(
      await startServer(apiConfig(url, { shutdownGraceMs: 1000 }), logger, {
        prefix,
        worker: { shutdownGraceMs: 3000 },
      }),
    );
    expect(server.shutdownBudgetMs).toBe(3000 + 2 * 2000);
  });

  it("reports a crash when its consumers cannot start", async () => {
    const url = await migratedDb();
    const server = track(
      await startServer(apiConfig(url), logger, {
        prefix,
        // BullMQ refuses a queue name with a colon.
        worker: { queueName: "bad:name" },
      }),
    );
    const { err } = await server.crashed;
    expect(String(err)).toMatch(/:/);
  });
});

describe("main", () => {
  it("returns 2 when DATABASE_URL is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");
    try {
      expect(await main()).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
