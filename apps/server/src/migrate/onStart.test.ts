import { fileURLToPath } from "node:url";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";
import { eventually } from "../../test/eventually.ts";
import { gate, onPort, type Gate } from "../../test/forwarder.ts";
import { withAdmin } from "../../test/pgAdmin.ts";
import { createEmptyDatabase } from "../../test/testDb.ts";
import { MIGRATE_KEY_NAME } from "../shared/lockKeys.ts";
import { migrateOnStart, retryable, startupGraceFromSecs } from "./onStart.ts";

const logger = pino({ level: "silent" });
const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));

let empty: Awaited<ReturnType<typeof createEmptyDatabase>>;
let gates: Gate[];

beforeEach(async () => {
  empty = await createEmptyDatabase(inject("postgresUrl"));
  gates = [];
});

afterEach(async () => {
  await Promise.all(gates.map((g) => g.close()));
  await empty.drop();
});

/** A gate in front of the empty database, turning connections away until opened. */
async function closedGate(): Promise<Gate> {
  const g = await gate(empty.url);
  gates.push(g);
  return g;
}

/** The runner's sessions waiting for the migration lock in this test's database. */
const lockWaiters = () =>
  withAdmin(empty.url, async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE l.locktype = 'advisory' AND NOT l.granted AND a.application_name = 'uroboros:migrate'
         AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    );
    return r.rows[0]?.n;
  });

const run = (url: string, opts: Partial<Parameters<typeof migrateOnStart>[0]> = {}) =>
  migrateOnStart({
    url,
    dir: fixture("migrations-ok"),
    grace: "forever",
    logger,
    retryMs: 50,
    ...opts,
  });

describe("startupGraceFromSecs", () => {
  it("reads 0 as forever and anything else as that many seconds", () => {
    expect(startupGraceFromSecs(0)).toBe("forever");
    expect(startupGraceFromSecs(30)).toEqual({ ms: 30_000 });
  });
});

describe("retryable", () => {
  it("retries socket and DNS errors and a server that is starting, not the rest", () => {
    for (const code of [
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ETIMEDOUT",
      "57P03",
    ]) {
      expect(retryable(Object.assign(new Error(code), { code })), code).toBe(true);
    }
    for (const code of ["28P01", "3D000", "ERR_INVALID_URL"]) {
      expect(retryable(Object.assign(new Error(code), { code })), code).toBe(false);
    }
  });
});

describe("migrateOnStart", () => {
  it("runs on a session with no statement or lock timeout, whatever the database sets", async () => {
    const name = new URL(empty.url).pathname.slice(1);
    await withAdmin(inject("postgresUrl"), async (admin) => {
      await admin.query(`ALTER DATABASE ${name} SET statement_timeout = '300ms'`);
      await admin.query(`ALTER DATABASE ${name} SET lock_timeout = '300ms'`);
    });
    // Another runner holds the migration lock for longer than the database's statement_timeout:
    // the wait must not be cut off.
    const outcome = await withAdmin(empty.url, async (holder) => {
      await holder.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATE_KEY_NAME]);
      const running = run(empty.url, { dir: fixture("migrations-session") });
      // A failure surfaces where `running` is awaited below, not as an unhandled rejection.
      running.catch(() => undefined);
      await eventually(async () => {
        expect(await lockWaiters()).toBe("1");
      });
      // Well past the database's 300 ms, the runner is still waiting rather than cut off.
      await new Promise((r) => setTimeout(r, 900));
      expect(await lockWaiters()).toBe("1");
      await holder.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATE_KEY_NAME]);
      return running;
    });
    expect(outcome.applied).toEqual(["20261122103000_record_session.sql"]);
    const settings = await withAdmin(
      empty.url,
      async (c) =>
        (
          await c.query<Record<string, string>>(
            "SELECT statement_timeout, lock_timeout, application_name FROM session_settings",
          )
        ).rows,
    );
    expect(settings).toEqual([
      { statement_timeout: "0", lock_timeout: "0", application_name: "uroboros:migrate" },
    ]);
  });

  it("closes its connection afterwards", async () => {
    await run(empty.url);
    const left = await withAdmin(empty.url, async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stat_activity
         WHERE datname = current_database() AND application_name = 'uroboros:migrate'`,
      );
      return r.rows[0]?.n;
    });
    expect(left).toBe("0");
  });

  it("retries a server that turns connections away until it answers", async () => {
    const g = await closedGate();
    const running = run(onPort(empty.url, g.port));
    running.catch(() => undefined);
    await eventually(() => {
      expect(g.refused).toBeGreaterThanOrEqual(2);
    });
    g.open();
    expect((await running).applied).toHaveLength(2);
  });

  it("gives up once the startup grace is spent", async () => {
    const g = await closedGate();
    const start = Date.now();
    await expect(run(onPort(empty.url, g.port), { grace: { ms: 400 } })).rejects.toThrow(
      /ECONNRESET/,
    );
    expect(Date.now() - start).toBeGreaterThanOrEqual(400);
    expect(Date.now() - start).toBeLessThan(3000);
    expect(g.refused).toBeGreaterThan(1);
  });

  it("does not retry at all with no grace (the migrate CLI)", async () => {
    const g = await closedGate();
    await expect(run(onPort(empty.url, g.port), { grace: "none" })).rejects.toThrow(/ECONNRESET/);
    expect(g.refused).toBe(1);
  });

  it("fails at once on what retrying cannot fix: a bad password, a malformed URL", async () => {
    const wrong = new URL(empty.url);
    wrong.password = "not-the-password";
    const start = Date.now();
    await expect(run(wrong.toString())).rejects.toThrow(/password authentication failed/);
    await expect(run("postgres://u:p@127.0.0.1:notaport/db")).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("stops retrying when aborted", async () => {
    const g = await closedGate();
    const stop = new AbortController();
    const running = run(onPort(empty.url, g.port), { signal: stop.signal, retryMs: 10_000 });
    running.catch(() => undefined);
    await eventually(() => {
      expect(g.refused).toBe(1);
    });
    const start = Date.now();
    stop.abort();
    await expect(running).rejects.toThrow(/aborted/);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
