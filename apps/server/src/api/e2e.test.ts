import { pino } from "pino";
import { afterAll, beforeAll, expect, it } from "vitest";
import { apiConfig } from "../../test/apiConfig.ts";
import { TestDb } from "../../test/testDb.ts";
import { startApi } from "./main.ts";
import type { RunningApi } from "./main.ts";

let testDb: TestDb;
let api: RunningApi;

beforeAll(async () => {
  testDb = await TestDb.create();
  api = await startApi(apiConfig(testDb.url), pino({ level: "silent" }));
  await api.attached;
});

afterAll(async () => {
  await api.close();
  await testDb.close();
});

it("serves /api/health and /api/ready over a real socket", async () => {
  const base = `http://127.0.0.1:${String(api.port)}`;
  const live = await fetch(`${base}/api/health`);
  expect(live.status).toBe(200);
  expect(await live.json()).toEqual({ status: "ok" });
  const ready = await fetch(`${base}/api/ready`);
  expect(ready.status).toBe(200);
  expect(await ready.json()).toEqual({ status: "ok", failing: [] });
});
