import type { OpenAPIHono } from "@hono/zod-openapi";
import { sql } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { apiConfig } from "../../test/apiConfig.ts";
import { silentProxy } from "../../test/silentProxy.ts";
import { TestDb } from "../../test/testDb.ts";
import type { Config } from "../config.ts";
import { LeaderStatus } from "../shared/leader.ts";
import { CLEANUP_MS } from "./drain.ts";
import { type RunningApi, runUntilSignal, startApi } from "./main.ts";

const logger = pino({ level: "silent" });

let testDb: TestDb;

beforeAll(async () => {
  testDb = await TestDb.create();
});

afterAll(async () => {
  await testDb.close();
});

const config = (shutdownGraceMs: number): Config => apiConfig(testDb.url, { shutdownGraceMs });

/** Starts the api and waits until it is ready, so test routes are served. */
async function ready(cfg: Config, opts: Parameters<typeof startApi>[2] = {}): Promise<RunningApi> {
  const api = await startApi(cfg, logger, opts);
  await api.attached;
  return api;
}

/** A route that answers only when `release()` is called; `entered` resolves once it is waiting. */
function slowRoute() {
  let release: () => void = () => undefined;
  let entered: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  return {
    release,
    entered: inside,
    configure: (app: OpenAPIHono) => {
      app.get("/test/slow", async (c) => {
        entered();
        await gate;
        return c.text("done");
      });
    },
  };
}

describe("api shutdown", () => {
  it("lets an in-flight request finish, refusing new connections meanwhile", async () => {
    const slow = slowRoute();
    const api = await ready(config(10_000), { configure: slow.configure });
    const base = `http://127.0.0.1:${String(api.port)}`;
    const inFlight = fetch(`${base}/test/slow`);
    await slow.entered;

    const closed = api.close();
    await expect(fetch(`${base}/api/health`)).rejects.toThrow();

    slow.release();
    const res = await inFlight;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("done");
    await expect(closed).resolves.toBeUndefined();
  });

  it("cuts a request that outlasts the grace period and reports the failed drain", async () => {
    const slow = slowRoute();
    const api = await ready(config(300), { configure: slow.configure });
    const inFlight = fetch(`http://127.0.0.1:${String(api.port)}/test/slow`);
    await slow.entered;

    const start = Date.now();
    await expect(api.close()).rejects.toThrow(/did not drain within 300 ms/);
    expect(Date.now() - start).toBeLessThan(2000);
    await expect(inFlight).rejects.toThrow();
    slow.release();
  });

  it("resolves the exit code 1 when SIGTERM's drain times out, 0 when it drains", async () => {
    const stuck = slowRoute();
    const api = await ready(config(300), { configure: stuck.configure });
    const inFlight = fetch(`http://127.0.0.1:${String(api.port)}/test/slow`).catch(() => "cut");
    await stuck.entered;
    const code = runUntilSignal(api, logger);
    process.emit("SIGTERM");
    expect(await code).toBe(1);
    expect(await inFlight).toBe("cut");
    stuck.release();

    const idle = await ready(config(300));
    const clean = runUntilSignal(idle, logger);
    process.emit("SIGTERM");
    expect(await clean).toBe(0);
  });

  it("gives up leadership while the drain is still waiting on a request", async () => {
    const slow = slowRoute();
    const api = await ready(config(10_000), { configure: slow.configure });
    await vi.waitFor(() => {
      expect(api.leader.leading).toBe(true);
    });
    const inFlight = fetch(`http://127.0.0.1:${String(api.port)}/test/slow`);
    await slow.entered;
    const closed = api.close();
    await vi.waitFor(() => {
      expect(api.leader.leading).toBe(false);
    });
    slow.release();
    expect((await inFlight).status).toBe(200);
    await closed;
  });
});

describe("bounded cleanup", () => {
  it("does not wait out a silent database's query timeout after the drain", async () => {
    const proxy = await silentProxy(testDb.url);
    try {
      let enter: () => void = () => undefined;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const api = await ready(apiConfig(proxy.url, { shutdownGraceMs: 300 }), {
        configure: (app, db) => {
          app.get("/test/query", async (c) => {
            // Opens the pool's connection first, so the next query runs on an established one.
            await sql`SELECT 1`.execute(db);
            enter();
            await sql`SELECT pg_sleep(0.5)`.execute(db);
            return c.text("done");
          });
        },
      });
      const inFlight = fetch(`http://127.0.0.1:${String(api.port)}/test/query`).catch(() => "cut");
      await entered;
      // The query now waits on a server that will never answer: its pool client stays checked
      // out until the pool's 30 s query timeout.
      proxy.silence();
      // Grace, then at most 2 s for the cut connections and 2 s for the cleanup.
      expect(api.shutdownBudgetMs).toBe(300 + 2 * CLEANUP_MS);
      const start = Date.now();
      await expect(api.close()).rejects.toThrow(/did not drain within 300 ms/);
      expect(Date.now() - start).toBeLessThan(api.shutdownBudgetMs + 1000);
      expect(await inFlight).toBe("cut");
    } finally {
      await proxy.close();
    }
  });
});

describe("hard exit", () => {
  const stuckApi = (budgetMs: number, close: () => Promise<void>): RunningApi => ({
    port: 0,
    attached: Promise.resolve(),
    leader: new LeaderStatus(),
    shutdownBudgetMs: budgetMs,
    close,
  });

  it("exits 1 itself when the shutdown outlasts its budget", async () => {
    const exit = vi.fn();
    const api = stuckApi(100, () => new Promise<void>(() => undefined));
    void runUntilSignal(api, logger, { exit, hardExitSlackMs: 50 });
    const start = Date.now();
    process.emit("SIGTERM");
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
  });

  it("disarms once the shutdown finishes in time", async () => {
    const exit = vi.fn();
    const api = stuckApi(100, () => Promise.resolve());
    const code = runUntilSignal(api, logger, { exit, hardExitSlackMs: 50 });
    process.emit("SIGTERM");
    expect(await code).toBe(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(exit).not.toHaveBeenCalled();
  });
});
