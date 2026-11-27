import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import { listRateLimitEvents, sweepOldRateLimitEvents } from "./rateLimitLog.ts";

/** The admin's log of rate limits (docs/health.md): newest first, kept a week. */

let t: TestDb;

beforeAll(async () => {
  t = await TestDb.create();
});
afterAll(async () => {
  await t.close();
});

const logged = (n: number, daysAgo: number, site = "log.test") =>
  t.db
    .insertInto("rate_limit_events")
    .values(
      Array.from({ length: n }, (_, i) => ({
        at: sql<Date>`now() - make_interval(days => ${daysAgo}, secs => ${i})`,
        site,
        scope: "site" as const,
        source: "download" as const,
        message: `limit ${String(i)}`,
        url: null,
        title: null,
        until: sql<Date>`now()`,
        hinted: false,
        strikes: i + 1,
      })),
    )
    .execute();

describe("the rate-limit log", () => {
  it("lists the newest first, at most the page's worth", async () => {
    await logged(3, 0, "new.test");
    const rows = await listRateLimitEvents(t.db, 2);
    expect(rows.map((r) => r.message)).toEqual(["limit 0", "limit 1"]);
    expect(rows[0]).toMatchObject({ site: "new.test", source: "download", strikes: 1 });
  });

  it("keeps a week", async () => {
    await logged(2, 8, "old.test");
    await logged(1, 6, "recent.test");
    expect(await sweepOldRateLimitEvents(t.db)).toBe(2);
    const sites = (await listRateLimitEvents(t.db, 100)).map((r) => r.site);
    expect(sites).not.toContain("old.test");
    expect(sites).toContain("recent.test");
  });
});
