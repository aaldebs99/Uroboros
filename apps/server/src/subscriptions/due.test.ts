import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { downloadHarness, seededDefault } from "../../test/downloads.ts";
import { insertSubscription } from "../../test/listings.ts";
import { liveJobs } from "../../test/jobs.ts";
import { TestDb } from "../../test/testDb.ts";
import { checkDueSubscriptions } from "./due.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let profileId: string;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  profileId = (await seededDefault(t.db)).id;
});
afterAll(async () => {
  await h.close();
  await t.close();
});
beforeEach(async () => {
  await t.db.updateTable("subscriptions").set({ next_check_at: null }).execute();
});

const feeds = [{ name: "Videos", url: "https://www.youtube.com/@b/videos" }];

/** A subscription of a fresh user, its next check `dueMin` minutes from now (negative: past). */
async function subscription(
  dueMin: number,
  o: { cron?: [string, string]; enabled?: boolean } = {},
): Promise<{ id: string; userId: string }> {
  const { userId } = await signedIn(t.db, { username: `due${String(++n)}` });
  const id = await insertSubscription(t.db, {
    userId,
    profileId,
    feeds,
    sourceId: `src${String(n)}`,
    enabled: o.enabled ?? true,
    ...(o.cron === undefined
      ? {}
      : { columns: { interval_minutes: null, cron: o.cron[0], cron_tz: o.cron[1] } }),
  });
  if (o.enabled !== false) {
    await sql`UPDATE subscriptions SET next_check_at = now() + make_interval(mins => ${dueMin})
      WHERE id = ${id}`.execute(t.db);
  }
  return { id, userId };
}

async function nextCheck(id: string): Promise<Date | null> {
  const row = await t.db
    .selectFrom("subscriptions")
    .select("next_check_at")
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  return row.next_check_at;
}

const queuedChecks = async () => (await liveJobs(t.db, "automation")).map((j) => j.key ?? "");

describe("the due-check pass", () => {
  it("queues a due check and moves it on by its interval, skipping runs missed meanwhile", async () => {
    // 6-hourly, due 13 hours ago: the next is 5 hours from now (missed runs are skipped).
    const s = await subscription(-13 * 60);
    expect(await checkDueSubscriptions(h.ctx)).toBe(1);
    expect(await queuedChecks()).toContain(`check|${s.id}`);
    const next = (await nextCheck(s.id))?.getTime() ?? 0;
    expect(next - Date.now()).toBeGreaterThan(5 * 3600_000 - 60_000);
    expect(next - Date.now()).toBeLessThan(5 * 3600_000 + 60_000);
  });

  it("moves a cron to its next tick", async () => {
    const s = await subscription(-1, { cron: ["0 0 1 1 *", "UTC"] });
    expect(await checkDueSubscriptions(h.ctx)).toBe(1);
    const next = await nextCheck(s.id);
    expect(next?.getUTCMonth()).toBe(0);
    expect(next?.getUTCDate()).toBe(1);
    expect(next?.getUTCHours()).toBe(0);
  });

  it("leaves checks that are not due, paused subscriptions, and owners disabled or revoked", async () => {
    const later = await subscription(30);
    await subscription(0, { enabled: false });
    const disabled = await subscription(-1);
    const revoked = await subscription(-1);
    await t.db
      .updateTable("users")
      .set({ disabled_at: new Date() })
      .where("id", "=", disabled.userId)
      .execute();
    await t.db
      .updateTable("users")
      .set({ revoked_at: new Date() })
      .where("id", "=", revoked.userId)
      .execute();
    expect(await checkDueSubscriptions(h.ctx)).toBe(0);
    expect((await nextCheck(later.id))?.getTime()).toBeGreaterThan(Date.now());
  });

  it("queues each due check once when two passes race", async () => {
    await subscription(-1);
    await subscription(-1);
    const [a, b] = await Promise.all([checkDueSubscriptions(h.ctx), checkDueSubscriptions(h.ctx)]);
    expect(a + b).toBe(2);
  });
});
