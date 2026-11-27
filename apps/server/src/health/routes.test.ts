import { randomUUID } from "node:crypto";
import { AdminHealth } from "@uroboros/contract";
import { sql } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { seedEntry } from "../../test/library.ts";
import { holdSite } from "../../test/rateLimits.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import { queueDownload } from "../downloads/dispatch.ts";

/** Admin › Health (docs/health.md): replicas, the version, cooldowns and the rate-limit log. */

const logger = pino({ level: "silent" });
const SELF = randomUUID();
let t: TestDb;
let root: SignedIn;
let ann: SignedIn;

beforeAll(async () => {
  t = await TestDb.create();
  root = await signedIn(t.db, { username: "hroot", role: "admin" });
  ann = await signedIn(t.db, { username: "hann" });
});
afterAll(async () => {
  await t.close();
});

const app = (s: SignedIn) =>
  asUser(createApp({ db: t.db, version: "0.1.5", replicaId: SELF, logger }, { webDist: null }), s);

async function health(): Promise<AdminHealth> {
  const res = await app(root).request("/api/admin/health");
  expect(res.status).toBe(200);
  return AdminHealth.parse(await res.json());
}

const checkIn = (
  id: string,
  host: string,
  opts: { ago?: string; leader?: boolean; failing?: string[]; version?: string } = {},
) =>
  t.db
    .insertInto("replicas")
    .values({
      id,
      host,
      pid: 7,
      version: opts.version ?? "0.1.5",
      started_at: sql<Date>`now() - interval '1 day'`,
      seen_at: sql<Date>`now() - ${opts.ago ?? "1 second"}::interval`,
      leader: opts.leader ?? false,
      failing: opts.failing ?? [],
    })
    .execute();

/** A job running on `worker` (host:pid). */
const running = (worker: string) =>
  t.db
    .insertInto("jobs")
    .values({
      queue: "download",
      name: "fetch",
      data: "{}",
      state: "running",
      max_stalls: 3,
      locked_by: randomUUID(),
      locked_until: sql<Date>`now() + interval '1 minute'`,
      worker,
    })
    .execute();

describe("Admin › Health", () => {
  it("answers admins only", async () => {
    expect((await app(ann).request("/api/admin/health")).status).toBe(403);
  });

  it("lists the replicas: this one first, each one's state, leader and running jobs", async () => {
    const quiet = randomUUID();
    const sick = randomUUID();
    const newer = randomUUID();
    await checkIn(sick, "b-host", { failing: ["storage", "something-newer"], version: "0.1.6" });
    // A newer replica's check this release can't name still fails it.
    await checkIn(newer, "c-host", { failing: ["something-newer"], version: "0.1.6" });
    await checkIn(quiet, "a-host", { ago: "2 minutes" });
    await checkIn(SELF, "z-host", { leader: true });
    await running("z-host:7");
    await running("z-host:7");
    await running("b-host:8");
    const { version, replicas } = await health();
    expect(version).toBe("0.1.5");
    expect(
      replicas.map((r) => [r.host, r.status, r.failing, r.leader, r.runningJobs, r.current]),
    ).toEqual([
      ["z-host", "ok", [], true, 2, true],
      ["a-host", "not_answering", [], false, 0, false],
      ["b-host", "degraded", ["storage"], false, 0, false],
      ["c-host", "degraded", [], false, 0, false],
    ]);
    expect(replicas.find((r) => r.host === "b-host")?.version).toBe("0.1.6");
  });

  it("lists each site's cooldown, running ones first, with what waits on it", async () => {
    const profile = await seededDefault(t.db);
    await holdSite(t.db, "youtube.com", "site", 600_000);
    await holdSite(t.db, "youtube.com", "subtitles", 60_000);
    await holdSite(t.db, "vimeo.com");
    await t.db
      .updateTable("site_cooldowns")
      .set({ until: sql<Date>`now() - interval '1 minute'` })
      .where("site", "=", "vimeo.com")
      .execute();
    // A download waiting on youtu.be waits on youtube.com; one that isn't held counts for none.
    for (const [videoId, url, held] of [
      ["h1", "https://youtu.be/h1", true],
      ["h2", "https://www.youtube.com/watch?v=h2", false],
    ] as const) {
      await t.db.transaction().execute((tx) =>
        queueDownload(tx, {
          userId: ann.userId,
          requestId: null,
          extractor: "youtube",
          videoId,
          url,
          title: videoId,
          profile,
        }),
      );
      if (held) {
        await t.db
          .updateTable("downloads")
          .set({ error_kind: "rate_limited", retry_at: sql<Date>`now() + interval '10 minutes'` })
          .where("video_id", "=", videoId)
          .execute();
      }
    }
    await t.db
      .insertInto("download_requests")
      .values({
        user_id: ann.userId,
        url: "https://m.youtube.com/watch?v=link",
        profile_id: profile.id,
        error_kind: "rate_limited",
        retry_at: sql<Date>`now() + interval '10 minutes'`,
      })
      .execute();
    const { cooldowns } = await health();
    expect(
      cooldowns.map((c) => [c.site, c.scope, c.active, c.waitingDownloads, c.waitingLinks]),
    ).toEqual([
      ["youtube.com", "site", true, 1, 1],
      ["youtube.com", "subtitles", true, 0, 0],
      ["vimeo.com", "site", false, 0, 0],
    ]);
    expect(cooldowns[0]?.strikes).toBe(1);
  });

  it("lists the newest 100 rate limits, newest first", async () => {
    await t.db
      .insertInto("rate_limit_events")
      .values(
        Array.from({ length: 101 }, (_, i) => ({
          at: sql<Date>`now() - make_interval(hours => 1, secs => ${i})`,
          site: "many.test",
          scope: "site" as const,
          source: "link" as const,
          message: `limit ${String(i)}`,
          url: "https://many.test/x",
          title: null,
          until: sql<Date>`now()`,
          hinted: true,
          strikes: i + 1,
        })),
      )
      .execute();
    await holdSite(t.db, "newest.test");
    const { events } = await health();
    expect(events).toHaveLength(100);
    expect(events[0]).toMatchObject({
      site: "newest.test",
      source: "download",
      message: "HTTP Error 429: Too Many Requests",
      hinted: false,
    });
    expect(events.find((e) => e.site === "many.test")?.message).toBe("limit 0");
  });

  it("links a held video in the admin's own library, and otherwise on its site", async () => {
    const mine = await seedEntry(t.db, root.userId, { videoId: "held-mine" });
    const theirs = await seedEntry(t.db, ann.userId, { videoId: "held-theirs" });
    for (const [media, title] of [
      [mine.mediaId, "Mine"],
      [theirs.mediaId, "Theirs"],
    ] as const) {
      await t.db
        .insertInto("rate_limit_events")
        .values({
          at: sql<Date>`now() + interval '1 minute'`,
          site: "linked.test",
          scope: "subtitles",
          source: "subtitles",
          message: "HTTP Error 429",
          url: `https://linked.test/${title}`,
          title,
          media_id: media,
          until: sql<Date>`now() + interval '2 minutes'`,
          hinted: false,
          strikes: 1,
        })
        .execute();
    }
    const { events } = await health();
    const linked = events.filter((e) => e.site === "linked.test");
    expect(linked.map((e) => [e.title, e.entryId])).toEqual(
      expect.arrayContaining([
        ["Mine", mine.entryId],
        ["Theirs", null],
      ]),
    );
  });
});
