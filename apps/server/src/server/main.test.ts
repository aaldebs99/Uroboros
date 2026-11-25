import { Writable } from "node:stream";
import { pino } from "pino";
import type { Logger } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiConfig } from "../../test/apiConfig.ts";
import { eventually } from "../../test/eventually.ts";
import { withAdmin } from "../../test/pgAdmin.ts";
import { TestDb } from "../../test/testDb.ts";
import type { RunningApi } from "../api/main.ts";
import { ConfigError, loadConfig } from "../config.ts";
import { MIGRATE_KEY_NAME } from "../shared/lockKeys.ts";
import { main, startServer } from "./main.ts";

const logger = pino({ level: "silent" });
const WAIT = { timeout: 15_000, interval: 50 };
const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
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

/** A logger that keeps every message it logs. */
function recording(): { logger: Logger; messages: string[] } {
  const messages: string[] = [];
  const out = new Writable({
    write(chunk: Buffer, _enc, done) {
      messages.push((JSON.parse(chunk.toString()) as { msg: string }).msg);
      done();
    },
  });
  return { logger: pino(out), messages };
}

describe("one server process", () => {
  it("starts its job consumers only once the database is attached, and stops them on close", async () => {
    const url = await migratedDb();
    const { logger: log, messages } = recording();
    const server = await withAdmin(url, async (c) => {
      // Another runner holds the migration lock, so this replica cannot attach yet.
      await c.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATE_KEY_NAME]);
      const s = track(await startServer(apiConfig(url), log));
      await new Promise((r) => setTimeout(r, 300));
      expect(messages).not.toContain("job consumers started");
      await c.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATE_KEY_NAME]);
      return s;
    });
    await server.attached;
    await eventually(() => {
      expect(messages).toContain("job consumers started");
    }, WAIT);
    await server.close();
  });

  it("budgets its shutdown for the longer of the HTTP drain and the consumers' grace", async () => {
    const url = await migratedDb();
    const server = track(
      await startServer(apiConfig(url, { shutdownGraceMs: 1000 }), logger, {
        worker: { shutdownGraceMs: 3000 },
      }),
    );
    expect(server.shutdownBudgetMs).toBe(3000 + 2 * 2000);
  });

  it("reports a crash when its consumers cannot start", async () => {
    const url = await migratedDb();
    const server = track(
      await startServer(apiConfig(url), logger, {
        worker: { consumers: () => Promise.reject(new Error("no consumers today")) },
      }),
    );
    const { err } = await server.crashed;
    expect(String(err)).toMatch(/no consumers today/);
  });
});

describe("main", () => {
  it("returns 2 when DATABASE_URL is missing", async () => {
    // Everything else a config needs is there, so the missing DATABASE_URL is the only reason.
    vi.stubEnv("UROBOROS_STORAGE", "filesystem");
    vi.stubEnv("UROBOROS_STORAGE_ROOT", "/media");
    vi.stubEnv("UROBOROS_BOOTSTRAP_USERNAME", "admin");
    vi.stubEnv("UROBOROS_BOOTSTRAP_PASSWORD", "correct horse battery");
    vi.stubEnv("DATABASE_URL", "");
    try {
      expect(() =>
        loadConfig({ ...process.env, DATABASE_URL: "postgres://u:p@h/db" }),
      ).not.toThrow();
      expect(() => loadConfig(process.env)).toThrow(
        new ConfigError("invalid configuration:\nDATABASE_URL: DATABASE_URL is required"),
      );
      expect(await main()).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
