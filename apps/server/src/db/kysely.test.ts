import { sql } from "kysely";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { silentProxy } from "../../test/silentProxy.ts";
import { TestDb } from "../../test/testDb.ts";
import { createDb } from "./kysely.ts";

let testDb: TestDb;

beforeEach(async () => {
  testDb = await TestDb.create();
});

afterEach(async () => {
  await testDb.close();
});

describe("createDb", () => {
  it("survives the socket of a checked-out client closing mid-query", async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (e: unknown) => uncaught.push(e);
    process.on("uncaughtException", onUncaught);
    const proxy = await silentProxy(testDb.url);
    const db = createDb(proxy.url, pino({ level: "silent" }));
    try {
      await sql`SELECT 1`.execute(db);
      const sleeping = sql`SELECT pg_sleep(10)`.execute(db);
      sleeping.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 100));
      // The connection dies under the query, with no error message first: pg rejects the query
      // and then emits 'error' on a client the pool has handed out.
      await proxy.close();
      await expect(sleeping).rejects.toThrow(/Connection terminated unexpectedly/);
      await new Promise((r) => setTimeout(r, 100));
      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
      await db.destroy();
    }
  });
});
