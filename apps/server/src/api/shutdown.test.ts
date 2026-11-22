import type { OpenAPIHono } from "@hono/zod-openapi";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import { TestValkey } from "../../test/testValkey.ts";
import type { Config } from "../config.ts";
import { runUntilSignal, startApi } from "./main.ts";

const logger = pino({ level: "silent" });

let testDb: TestDb;

beforeAll(async () => {
  testDb = await TestDb.create();
});

afterAll(async () => {
  await testDb.close();
});

const config = (shutdownGraceMs: number): Config => ({
  bind: { host: "127.0.0.1", port: 0 },
  databaseUrl: testDb.url,
  valkeyUrl: TestValkey.url(),
  webDist: null,
  shutdownGraceMs,
  push: { publicBaseUrl: null, subject: null, vapid: null, allowedHosts: [], maxDevices: 10 },
});

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
      app.get("/api/test/slow", async (c) => {
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
    const api = await startApi(config(10_000), logger, { configure: slow.configure });
    const base = `http://127.0.0.1:${String(api.port)}`;
    const inFlight = fetch(`${base}/api/test/slow`);
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
    const api = await startApi(config(300), logger, { configure: slow.configure });
    const inFlight = fetch(`http://127.0.0.1:${String(api.port)}/api/test/slow`);
    await slow.entered;

    const start = Date.now();
    await expect(api.close()).rejects.toThrow(/did not drain within 300 ms/);
    expect(Date.now() - start).toBeLessThan(2000);
    await expect(inFlight).rejects.toThrow();
    slow.release();
  });

  it("resolves the exit code 1 when SIGTERM's drain times out, 0 when it drains", async () => {
    const stuck = slowRoute();
    const api = await startApi(config(300), logger, { configure: stuck.configure });
    const inFlight = fetch(`http://127.0.0.1:${String(api.port)}/api/test/slow`).catch(() => "cut");
    await stuck.entered;
    const code = runUntilSignal(api, logger);
    process.emit("SIGTERM");
    expect(await code).toBe(1);
    expect(await inFlight).toBe("cut");
    stuck.release();

    const idle = await startApi(config(300), logger);
    const clean = runUntilSignal(idle, logger);
    process.emit("SIGTERM");
    expect(await clean).toBe(0);
  });
});
