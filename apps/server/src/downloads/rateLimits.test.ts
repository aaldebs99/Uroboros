import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import {
  activeCooldown,
  clearRateLimit,
  noteRateLimit,
  requeueDelay,
  siteOf,
} from "./rateLimits.ts";

let t: TestDb;

beforeAll(async () => {
  t = await TestDb.create();
});
afterAll(async () => {
  await t.close();
});

/** Seconds from the database's now to `until`, rounded. */
const secondsTo = async (until: Date) => {
  const { rows } = await sql<{ s: number }>`
    SELECT round(extract(epoch FROM ${until}::timestamptz - now()))::int AS s`.execute(t.db);
  return rows[0]?.s;
};

/** Ends a cooldown, as time passing would. */
const expire = (site: string) =>
  t.db
    .updateTable("site_cooldowns")
    .set({ until: sql`now() - interval '1 second'` })
    .where("site", "=", site)
    .execute();

describe("siteOf", () => {
  it("keys a site by its host, whatever subdomain or short link points at it", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=x",
      "https://youtu.be/x",
      "https://m.youtube.com/watch?v=x",
      "https://music.youtube.com/watch?v=x",
      "https://www.youtube-nocookie.com/embed/x",
    ]) {
      expect(siteOf(url)).toBe("youtube.com");
    }
    expect(siteOf("https://VIMEO.com/123")).toBe("vimeo.com");
    expect(siteOf("https://player.vimeo.com/video/1")).toBe("player.vimeo.com");
    expect(siteOf("not a link")).toBe("not a link");
  });
});

describe("a site's cooldown", () => {
  it("waits 1, 2, then 4 minutes for limits in a row when the site gives no time", async () => {
    expect(await activeCooldown(t.db, "a.test", "site")).toBeNull();
    expect(await secondsTo(await noteRateLimit(t.db, "a.test", "site", null))).toBe(60);
    await expire("a.test");
    expect(await secondsTo(await noteRateLimit(t.db, "a.test", "site", null))).toBe(120);
    await expire("a.test");
    expect(await secondsTo(await noteRateLimit(t.db, "a.test", "site", null))).toBe(240);
    expect(await activeCooldown(t.db, "a.test", "site")).toBeInstanceOf(Date);
    // The other scope is its own.
    expect(await activeCooldown(t.db, "a.test", "subtitles")).toBeNull();
  });

  it("waits as long as the site said, and never less than it already waits", async () => {
    expect(await secondsTo(await noteRateLimit(t.db, "b.test", "site", 3_600_000))).toBe(3600);
    // A shorter estimate from a later limit leaves the hour standing.
    expect(await secondsTo(await noteRateLimit(t.db, "b.test", "site", null))).toBe(3600);
  });

  it("is cleared by a success only once it has run out", async () => {
    await noteRateLimit(t.db, "c.test", "subtitles", null);
    await clearRateLimit(t.db, "c.test", "subtitles");
    expect(await activeCooldown(t.db, "c.test", "subtitles")).not.toBeNull();
    await expire("c.test");
    await clearRateLimit(t.db, "c.test", "subtitles");
    // Cleared, so the next limit starts the estimate over at a minute.
    expect(await secondsTo(await noteRateLimit(t.db, "c.test", "subtitles", null))).toBe(60);
  });

  it("puts waiting jobs back just after it ends, spread over 15 seconds", () => {
    const until = new Date(Date.now() + 60_000);
    for (let i = 0; i < 20; i++) {
      const delay = requeueDelay(until);
      expect(delay).toBeGreaterThanOrEqual(59_000);
      expect(delay).toBeLessThanOrEqual(75_000);
    }
    expect(requeueDelay(new Date(Date.now() - 5000))).toBeLessThanOrEqual(15_000);
  });
});
