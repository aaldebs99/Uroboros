import { sql } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { eventually } from "../../test/eventually.ts";
import { createSession, resolveSession } from "./sessions.ts";
import { sweeperDuty } from "./sweeper.ts";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await TestDb.create();
});
afterAll(async () => {
  await testDb.close();
});

describe("sweeperDuty", () => {
  it("sweeps at once when it starts leading, then resolves when leadership ends", async () => {
    const live = await signedIn(testDb.db, { username: "sweepy" });
    const dead = await createSession(testDb.db, {
      userId: live.userId,
      ttlHours: 1,
      userAgent: null,
    });
    await testDb.db
      .updateTable("auth_sessions")
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where("csrf", "=", dead.csrf)
      .execute();
    const stop = new AbortController();
    const running = sweeperDuty(testDb.db, pino({ level: "silent" }))(stop.signal);
    await eventually(async () => {
      const left = await testDb.db
        .selectFrom("auth_sessions")
        .select("csrf")
        .where("user_id", "=", live.userId)
        .execute();
      expect(left.map((r) => r.csrf)).toEqual([live.csrf]);
    });
    expect(await resolveSession(testDb.db, live.token)).not.toBeNull();
    stop.abort();
    await expect(running).resolves.toBeUndefined();
  });

  it("drops rate limits logged over a week ago", async () => {
    await testDb.db
      .insertInto("rate_limit_events")
      .values({
        at: sql<Date>`now() - interval '8 days'`,
        site: "swept.test",
        scope: "site",
        source: "download",
        message: "HTTP Error 429",
        url: null,
        title: null,
        until: sql<Date>`now() - interval '8 days'`,
        hinted: false,
        strikes: 1,
      })
      .execute();
    const stop = new AbortController();
    const running = sweeperDuty(testDb.db, pino({ level: "silent" }))(stop.signal);
    await eventually(async () => {
      const left = await testDb.db
        .selectFrom("rate_limit_events")
        .select("id")
        .where("site", "=", "swept.test")
        .execute();
      expect(left).toEqual([]);
    });
    stop.abort();
    await running;
  });

  it("ends promptly when leadership was already lost before the first sweep finished", async () => {
    const stop = new AbortController();
    stop.abort();
    const done = sweeperDuty(testDb.db, pino({ level: "silent" }))(stop.signal);
    const outcome = await Promise.race([
      done.then(() => "resolved"),
      new Promise((r) =>
        setTimeout(() => {
          r("hung");
        }, 1000),
      ),
    ]);
    expect(outcome).toBe("resolved");
  });
});
