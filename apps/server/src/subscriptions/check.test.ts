import type { Scenario } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { FeedJson } from "../db/schema.ts";
import { saveLogin } from "../siteLogins/store.ts";
import { checkFailure, checkProcessor } from "./check.ts";
import { PatternTimeout } from "./patterns.ts";
import { listing, sleep, type ListedVideo } from "../../test/listings.ts";
import { takeLease } from "./lease.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let profileId: string;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db, 1000);
  profileId = (await seededDefault(t.db)).id;
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const base = "https://www.youtube.com/@BlenderOfficial";
const videos = `${base}/videos`;
const streams = `${base}/streams`;

let n = 0;
const user = (): Promise<SignedIn> => signedIn(t.db, { username: `c${String(++n)}` });
const vids = (prefix: string, count: number): ListedVideo[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${String(i)}` }));

async function subscription(
  userId: string,
  feeds: FeedJson[],
  over: Partial<{
    backfill: "none" | "newest" | "all";
    backfill_count: number;
    kind: "channel" | "playlist";
    uploaded_after: string;
    title_exclude: string;
  }> = {},
) {
  const row = await t.db
    .insertInto("subscriptions")
    .values({
      user_id: userId,
      kind: over.kind ?? "channel",
      extractor: "youtube",
      source_id: `UC${String(++n)}`,
      title: "Blender",
      url: base,
      feeds: JSON.stringify(feeds),
      tabs: JSON.stringify(feeds),
      profile_id: profileId,
      interval_minutes: 360,
      backfill: over.backfill ?? "none",
      backfill_count: over.backfill_count ?? null,
      uploaded_after: over.uploaded_after ?? null,
      title_exclude: over.title_exclude ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function check(id: string, scenario: Scenario, maxPlaylistEntries = 1000) {
  const deps = await h.deps(scenario);
  await checkProcessor({ ...deps, limits: { ...deps.limits, maxPlaylistEntries } })({
    data: { subscriptionId: id },
  });
}

const items = (id: string) =>
  t.db
    .selectFrom("subscription_items")
    .select(["video_id", "outcome"])
    .where("subscription_id", "=", id)
    .orderBy("video_id")
    .execute();

const downloads = (id: string) =>
  t.db
    .selectFrom("downloads")
    .select(["video_id", "priority", "state"])
    .where("subscription_id", "=", id)
    .orderBy("video_id")
    .execute();

const row = (id: string) =>
  t.db.selectFrom("subscriptions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

describe("subscription checks", () => {
  it("lists with the owner's saved logins", async () => {
    const key = Buffer.alloc(32, 4);
    const u = await user();
    await saveLogin(t.db, key, u.userId, "vimeo", { username: "owner", password: "owner-pw" });
    const id = await subscription(u.userId, [{ name: "Videos", url: videos }]);
    const deps = await h.deps({
      steps: [
        { copyArgFile: "--netrc-location", name: ".netrc", as: "seen" },
        { stdout: listing(videos, vids("l", 1)) },
      ],
    });
    await checkProcessor({ ...deps, ytdlp: { ...deps.ytdlp, secretsKey: key } })({
      data: { subscriptionId: id },
    });
    expect(await h.lastCopied("seen")).toBe('machine vimeo login "owner" password "owner-pw"\n');
    expect((await items(id)).map((i) => i.outcome)).toEqual(["existing"]);
  });

  it("records everything as existing on a none backfill and queues nothing", async () => {
    const u = await user();
    const id = await subscription(u.userId, [{ name: "Videos", url: videos }]);
    await check(id, { steps: [{ stdout: listing(videos, vids("n", 3)) }] });
    expect((await items(id)).map((i) => i.outcome)).toEqual(["existing", "existing", "existing"]);
    expect(await downloads(id)).toEqual([]);
    const after = await row(id);
    expect(after.feeds[0]?.primedAt).toBeTruthy();
    expect(after.last_checked_at).not.toBeNull();
    expect(after.lease_until).toBeNull();
  });

  it("queues the newest N of each tab on a newest backfill, at priority 1", async () => {
    const u = await user();
    const id = await subscription(
      u.userId,
      [
        { name: "Videos", url: videos },
        { name: "Live", url: streams },
      ],
      { backfill: "newest", backfill_count: 2 },
    );
    await check(id, {
      steps: [],
      variants: [
        { whenArg: videos, steps: [{ stdout: listing(videos, vids("v", 3)) }] },
        { whenArg: streams, steps: [{ stdout: listing(streams, vids("s", 3)) }] },
      ],
    });
    expect(await downloads(id)).toEqual(
      ["s0", "s1", "v0", "v1"].map((v) => ({ video_id: v, priority: 1, state: "queued" })),
    );
    expect(await items(id)).toEqual([
      { video_id: "s0", outcome: "queued" },
      { video_id: "s1", outcome: "queued" },
      { video_id: "s2", outcome: "existing" },
      { video_id: "v0", outcome: "queued" },
      { video_id: "v1", outcome: "queued" },
      { video_id: "v2", outcome: "existing" },
    ]);
  });

  it("queues only unseen entries on a later check, at priority 0", async () => {
    const u = await user();
    const id = await subscription(u.userId, [{ name: "Videos", url: videos }]);
    await check(id, { steps: [{ stdout: listing(videos, vids("l", 2)) }] });
    await check(id, { steps: [{ stdout: listing(videos, [{ id: "lnew" }, ...vids("l", 2)]) }] });
    expect(await downloads(id)).toEqual([{ video_id: "lnew", priority: 0, state: "queued" }]);
  });

  it("primes a tab added later with none", async () => {
    const u = await user();
    const id = await subscription(u.userId, [{ name: "Videos", url: videos }], {
      backfill: "all",
    });
    const scenario = {
      steps: [],
      variants: [
        { whenArg: videos, steps: [{ stdout: listing(videos, vids("a", 1)) }] },
        { whenArg: streams, steps: [{ stdout: listing(streams, vids("b", 2)) }] },
      ],
    };
    await check(id, scenario);
    const primed = (await row(id)).feeds;
    await t.db
      .updateTable("subscriptions")
      .set({ feeds: JSON.stringify([...primed, { name: "Live", url: streams, primedAt: null }]) })
      .where("id", "=", id)
      .execute();
    await check(id, scenario);
    expect((await downloads(id)).map((d) => d.video_id)).toEqual(["a0"]);
    expect((await items(id)).filter((i) => i.video_id.startsWith("b"))).toEqual([
      { video_id: "b0", outcome: "existing" },
      { video_id: "b1", outcome: "existing" },
    ]);
  });

  it("runs one of two concurrent checks", async () => {
    const u = await user();
    const id = await subscription(u.userId, [{ name: "Videos", url: videos }]);
    const slow = { steps: [{ sleepMs: 400 }, { stdout: listing(videos, vids("x", 1)) }] };
    const first = check(id, slow).then(() => "first");
    await sleep(100);
    const second = check(id, slow).then(() => "second");
    expect(await Promise.race([first, second])).toBe("second");
    await first;
    expect(await items(id)).toEqual([{ video_id: "x0", outcome: "existing" }]);
  });

  it("skips a disabled owner", async () => {
    const u = await user();
    const id = await subscription(u.userId, [{ name: "Videos", url: videos }]);
    await t.db
      .updateTable("users")
      .set({ disabled_at: new Date() })
      .where("id", "=", u.userId)
      .execute();
    expect(await takeLease(t.db, id)).toBeUndefined();
    await check(id, { steps: [{ stdout: listing(videos, vids("d", 1)) }] });
    expect((await row(id)).last_checked_at).toBeNull();
  });

  it("records a failed listing and keeps the lease free", async () => {
    const u = await user();
    const id = await subscription(u.userId, [{ name: "Videos", url: videos }]);
    await check(id, {
      steps: [{ stderr: "ERROR: [youtube:tab] @gone: This channel does not exist.\n" }],
      exitCode: 1,
    });
    const after = await row(id);
    expect(after.last_error_kind).not.toBeNull();
    expect(after.last_error_message).toBeTruthy();
    expect(after.failures).toBe(1);
    expect(after.lease_until).toBeNull();
    expect(after.feeds[0]?.primedAt ?? null).toBeNull();
  });

  it("sets a warning when a playlist reaches the entry cap", async () => {
    const u = await user();
    const url = "https://www.youtube.com/playlist?list=PL1";
    const id = await subscription(u.userId, [{ name: "Playlist", url }], { kind: "playlist" });
    await check(id, { steps: [{ stdout: listing(url, vids("p", 3)) }] }, 3);
    expect((await row(id)).warning).toMatch(/first 3/);
  });

  it("probes a video only when a filter needs it", async () => {
    const u = await user();
    const id = await subscription(u.userId, [{ name: "Videos", url: videos }], {
      backfill: "all",
      uploaded_after: "2026-11-01",
    });
    const watch = (v: string) => `https://www.youtube.com/watch?v=${v}`;
    await check(id, {
      steps: [],
      variants: [
        { whenArg: videos, steps: [{ stdout: listing(videos, vids("p", 2)) }] },
        { whenArg: watch("p0"), steps: [{ stdout: video("p0", "20261115") }] },
        { whenArg: watch("p1"), steps: [{ stdout: video("p1", "20261015") }] },
      ],
    });
    expect(await items(id)).toEqual([
      { video_id: "p0", outcome: "queued" },
      { video_id: "p1", outcome: "filtered" },
    ]);
  });

  it("does not probe for a title filter", async () => {
    const u = await user();
    const id = await subscription(u.userId, [{ name: "Videos", url: videos }], {
      backfill: "all",
      title_exclude: "\\ylive\\y",
    });
    await check(id, {
      steps: [{ stderr: "ERROR: probed when it should not have\n" }],
      exitCode: 1,
      variants: [
        {
          whenArg: videos,
          steps: [{ stdout: listing(videos, [{ id: "t0", title: "Live now!" }, { id: "t1" }]) }],
        },
      ],
    });
    expect(await items(id)).toEqual([
      { video_id: "t0", outcome: "filtered" },
      { video_id: "t1", outcome: "queued" },
    ]);
  });

  it("stops probing at the budget and leaves the rest for next time", async () => {
    const u = await user();
    const id = await subscription(u.userId, [{ name: "Videos", url: videos }], {
      backfill: "all",
      uploaded_after: "2026-01-01",
    });
    await check(id, {
      steps: [{ stdout: video("any", "20261115") }],
      variants: [{ whenArg: videos, steps: [{ stdout: listing(videos, vids("b", 55)) }] }],
    });
    const recorded = await items(id);
    expect(recorded.filter((i) => i.outcome === "queued")).toHaveLength(50);
    // The rest wait, still the backfill, for the next check's probes.
    expect(recorded.filter((i) => i.outcome === "waiting")).toHaveLength(5);
  }, 60_000);

  it("records nothing for a check cut by shutdown", async () => {
    const u = await user();
    const id = await subscription(u.userId, [{ name: "Videos", url: videos }]);
    const deps = await h.deps({ steps: [{ sleepMs: 3000 }, { stdout: listing(videos, []) }] });
    const stop = new AbortController();
    const running = checkProcessor(deps, stop.signal)({ data: { subscriptionId: id } });
    await sleep(200);
    stop.abort();
    await running;
    const after = await row(id);
    expect(after).toMatchObject({ failures: 0, last_error_kind: null, lease_until: null });
    expect(after.last_checked_at).toBeNull();
  });

  it("fails the check when a pattern times out", () => {
    expect(checkFailure(new PatternTimeout())).toEqual({
      kind: "unknown",
      message: "a title pattern took too long",
    });
  });
});

/** A full (not flat) probe of one video, uploaded on `uploadDate` (YYYYMMDD). */
function video(id: string, uploadDate: string): string {
  return JSON.stringify({
    _type: "video",
    id,
    title: `Video ${id}`,
    duration: 300,
    upload_date: uploadDate,
    extractor_key: "Youtube",
    webpage_url: `https://www.youtube.com/watch?v=${id}`,
  });
}
