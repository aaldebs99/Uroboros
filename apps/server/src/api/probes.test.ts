import type { OpenAPIHono } from "@hono/zod-openapi";
import { Liveness, Readiness } from "@uroboros/contract";
import type { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { TestValkey } from "../../test/testValkey.ts";
import { createDb } from "../db/kysely.ts";
import { createValkey, waitReady } from "../shared/valkey.ts";
import { createApp } from "./app.ts";

const logger = pino({ level: "silent" });

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

/** An app whose database is attached only once `attach()` is called. */
function starting(): { app: OpenAPIHono; attach(): void } {
  let attached = false;
  const app = createApp(
    { db: testDb.db, valkey, version: "t", logger, attached: () => attached },
    { webDist: null },
  );
  return {
    app,
    attach() {
      attached = true;
    },
  };
}

describe("liveness", () => {
  it("answers ok without touching a dependency, attached or not", async () => {
    const down = createDb("postgres://u:p@127.0.0.1:1/x", logger);
    try {
      const { app } = starting();
      for (const a of [
        app,
        createApp({ db: down, valkey, version: "t", logger }, { webDist: null }),
      ]) {
        const res = await a.request("/api/health");
        expect(res.status).toBe(200);
        expect(Liveness.parse(await res.json())).toEqual({ status: "ok" });
      }
    } finally {
      await down.destroy();
    }
  });
});

describe("readiness", () => {
  it("is 503 starting until the database is attached, then 200 ok", async () => {
    const s = starting();
    const before = await s.app.request("/api/ready");
    expect(before.status).toBe(503);
    expect(Readiness.parse(await before.json())).toEqual({ status: "starting", failing: [] });
    s.attach();
    const after = await s.app.request("/api/ready");
    expect(after.status).toBe(200);
    expect(Readiness.parse(await after.json())).toEqual({ status: "ok", failing: [] });
  });

  it("refuses database routes with 503 unavailable while starting, and serves the rest", async () => {
    const s = starting();
    const push = await s.app.request("/api/me/push");
    expect(push.status).toBe(503);
    expect(await push.json()).toEqual({ code: "unavailable", message: "the server is starting" });
    for (const path of ["/api/info", "/api/openapi.json", "/api/docs"]) {
      expect((await s.app.request(path)).status, path).toBe(200);
    }
    s.attach();
    const user = await signedIn(testDb.db, { username: "prober" });
    expect((await asUser(s.app, user).request("/api/me/push")).status).toBe(200);
  });
});
