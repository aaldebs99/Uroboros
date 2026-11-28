import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import {
  activeCooldown,
  clearRateLimit,
  type LimitEvent,
  noteRateLimit as note,
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

/** A limit as a fetch meets it, for the tests that look only at the cooldown. */
const AT_FETCH: LimitEvent = {
  source: "download",
  message: "HTTP Error 429: Too Many Requests",
  url: "https://a.test/v/1",
  title: "A video",
};
const noteRateLimit = (
  db: TestDb["db"],
  site: string,
  scope: "site" | "subtitles",
  hintMs: number | null,
) => note(db, site, scope, hintMs, AT_FETCH);

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
  it("waits 5, 10, then 20 minutes for limits in a row when the site gives no time", async () => {
    expect(await activeCooldown(t.db, "a.test", "site")).toBeNull();
    expect(await secondsTo(await noteRateLimit(t.db, "a.test", "site", null))).toBe(300);
    await expire("a.test");
    expect(await secondsTo(await noteRateLimit(t.db, "a.test", "site", null))).toBe(600);
    await expire("a.test");
    expect(await secondsTo(await noteRateLimit(t.db, "a.test", "site", null))).toBe(1200);
    expect(await activeCooldown(t.db, "a.test", "site")).toBeInstanceOf(Date);
    // The other scope is its own.
    expect(await activeCooldown(t.db, "a.test", "subtitles")).toBeNull();
  });

  it("waits at most 2 hours for a site, however many limits in a row", async () => {
    await noteRateLimit(t.db, "cap.test", "site", null);
    await t.db
      .updateTable("site_cooldowns")
      .set({ strikes: 12 })
      .where("site", "=", "cap.test")
      .execute();
    await expire("cap.test");
    expect(await secondsTo(await noteRateLimit(t.db, "cap.test", "site", null))).toBe(7200);
  });

  it("waits longer for subtitles, which nobody waits to watch: 15, 30, 60 minutes, at most 6 hours", async () => {
    expect(await secondsTo(await noteRateLimit(t.db, "subs.test", "subtitles", null))).toBe(900);
    await expire("subs.test");
    expect(await secondsTo(await noteRateLimit(t.db, "subs.test", "subtitles", null))).toBe(1800);
    await expire("subs.test");
    expect(await secondsTo(await noteRateLimit(t.db, "subs.test", "subtitles", null))).toBe(3600);
    await t.db
      .updateTable("site_cooldowns")
      .set({ strikes: 12 })
      .where("site", "=", "subs.test")
      .execute();
    await expire("subs.test");
    expect(await secondsTo(await noteRateLimit(t.db, "subs.test", "subtitles", null))).toBe(21_600);
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
    // Cleared, so the next limit starts the estimate over: 15 minutes for subtitles.
    expect(await secondsTo(await noteRateLimit(t.db, "c.test", "subtitles", null))).toBe(900);
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

describe("the rate-limit log", () => {
  const events = (site: string) =>
    t.db
      .selectFrom("rate_limit_events")
      .selectAll()
      .where("site", "=", site)
      .orderBy("strikes")
      .execute();

  it("records each limit: the work, yt-dlp's message, the video and the cooldown it set", async () => {
    const first = await note(t.db, "log.test", "site", null, {
      source: "link",
      message: "Sign in to confirm you're not a bot",
      url: "https://log.test/watch?v=1",
      title: null,
    });
    await expire("log.test");
    const second = await note(t.db, "log.test", "site", 1_800_000, AT_FETCH);
    const [a, b] = await events("log.test");
    expect(a).toMatchObject({
      scope: "site",
      source: "link",
      message: "Sign in to confirm you're not a bot",
      url: "https://log.test/watch?v=1",
      title: null,
      until: first,
      hinted: false,
      strikes: 1,
    });
    expect(b).toMatchObject({
      source: "download",
      message: "HTTP Error 429: Too Many Requests",
      url: "https://a.test/v/1",
      title: "A video",
      until: second,
      hinted: true,
      strikes: 2,
    });
  });

  it("records the cooldown that stands when a longer one already runs", async () => {
    const hour = await note(t.db, "long.test", "subtitles", 3_600_000, {
      ...AT_FETCH,
      source: "subtitles",
    });
    await note(t.db, "long.test", "subtitles", null, { ...AT_FETCH, source: "subtitles" });
    // The site says 30 s, but the hour stands: that wait isn't the one the site said.
    await note(t.db, "long.test", "subtitles", 30_000, { ...AT_FETCH, source: "subtitles" });
    const rows = await events("long.test");
    expect(rows.map((r) => [r.scope, r.until, r.hinted])).toEqual([
      ["subtitles", hour, true],
      ["subtitles", hour, false],
      ["subtitles", hour, false],
    ]);
  });

  it("drops NUL characters, which a text column refuses, and still records the cooldown", async () => {
    const until = await note(t.db, "nul.test", "site", null, {
      ...AT_FETCH,
      message: "HTTP Error 429\u0000: Too Many Requests",
    });
    const [row] = await events("nul.test");
    expect(row).toMatchObject({ message: "HTTP Error 429: Too Many Requests", until });
  });

  it("records the stored video a limit held, when there is one", async () => {
    const media = await t.db
      .insertInto("media")
      .values({ extractor: "youtube", video_id: "rl-media" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await note(t.db, "media.test", "subtitles", null, {
      ...AT_FETCH,
      source: "subtitles",
      mediaId: media.id,
    });
    await note(t.db, "media.test", "site", null, AT_FETCH);
    const rows = await t.db
      .selectFrom("rate_limit_events")
      .select(["source", "media_id"])
      .where("site", "=", "media.test")
      .orderBy("source", "desc")
      .execute();
    expect(rows).toEqual([
      { source: "subtitles", media_id: media.id },
      { source: "download", media_id: null },
    ]);
  });

  it("keeps the first 1000 characters of a long message", async () => {
    await note(t.db, "big.test", "site", null, { ...AT_FETCH, message: "x".repeat(3000) });
    const [row] = await events("big.test");
    expect(row?.message).toHaveLength(1000);
  });
});
