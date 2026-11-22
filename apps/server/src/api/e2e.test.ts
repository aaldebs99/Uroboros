import { pino } from "pino";
import { afterAll, beforeAll, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import { TestValkey } from "../../test/testValkey.ts";
import { startApi } from "./main.ts";
import type { RunningApi } from "./main.ts";

let testDb: TestDb;
let api: RunningApi;

beforeAll(async () => {
  testDb = await TestDb.create();
  api = await startApi(
    {
      bind: { host: "127.0.0.1", port: 0 },
      databaseUrl: testDb.url,
      valkeyUrl: TestValkey.url(),
      webDist: null,
    },
    pino({ level: "silent" }),
  );
});

afterAll(async () => {
  await api.close();
  await testDb.close();
});

it("serves /api/health over a real socket", async () => {
  const res = await fetch(`http://127.0.0.1:${String(api.port)}/api/health`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", failing: [] });
});
