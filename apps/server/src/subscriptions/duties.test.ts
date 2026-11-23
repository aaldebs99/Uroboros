import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { downloadHarness, seededDefault } from "../../test/downloads.ts";
import { insertSubscription } from "../../test/listings.ts";
import { TestDb } from "../../test/testDb.ts";
import { resyncSchedulers } from "./duties.ts";
import { scheduleCheck } from "./queue.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let profileId: string;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  profileId = (await seededDefault(t.db)).id;
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const feeds = [{ name: "Videos", url: "https://www.youtube.com/@b/videos" }];

describe("scheduler re-sync", () => {
  it("adds a missing scheduler, fixes an interval, and removes stale ones", async () => {
    const u = await signedIn(t.db, { username: "resync" });
    const gone = await signedIn(t.db, { username: "resync-disabled" });
    const missing = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      feeds,
      sourceId: "A",
    });
    const wrong = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      feeds,
      sourceId: "B",
      intervalMinutes: 60,
    });
    await scheduleCheck(h.queues.automation, { id: wrong, interval_minutes: 720, enabled: true });
    const paused = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      feeds,
      sourceId: "C",
      enabled: false,
    });
    await scheduleCheck(h.queues.automation, { id: paused, interval_minutes: 360, enabled: true });
    const disabledOwner = await insertSubscription(t.db, {
      userId: gone.userId,
      profileId,
      feeds,
      sourceId: "D",
    });
    await scheduleCheck(h.queues.automation, {
      id: disabledOwner,
      interval_minutes: 360,
      enabled: true,
    });
    await t.db
      .updateTable("users")
      .set({ disabled_at: new Date() })
      .where("id", "=", gone.userId)
      .execute();
    const orphan = "0190a3f2-7c1e-7000-8000-00000000dead";
    await scheduleCheck(h.queues.automation, { id: orphan, interval_minutes: 360, enabled: true });

    expect(await resyncSchedulers(t.db, h.queues.automation)).toEqual({ added: 2, removed: 3 });
    const every = async (id: string) => (await h.queues.automation.getJobScheduler(id))?.every;
    expect(await every(missing)).toBe(21_600_000);
    expect(await every(wrong)).toBe(3_600_000);
    expect(await every(paused)).toBeUndefined();
    expect(await every(disabledOwner)).toBeUndefined();
    expect(await every(orphan)).toBeUndefined();
    expect(await resyncSchedulers(t.db, h.queues.automation)).toEqual({ added: 0, removed: 0 });
  });
});
