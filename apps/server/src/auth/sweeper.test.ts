import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
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
    await new Promise((r) => setTimeout(r, 200));
    const left = await testDb.db
      .selectFrom("auth_sessions")
      .select("csrf")
      .where("user_id", "=", live.userId)
      .execute();
    expect(left.map((r) => r.csrf)).toEqual([live.csrf]);
    expect(await resolveSession(testDb.db, live.token)).not.toBeNull();
    stop.abort();
    await expect(running).resolves.toBeUndefined();
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
