import { randomUUID } from "node:crypto";
import { ApiErrorBody, Subscription, SubscriptionItemsPage } from "@uroboros/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness, post, seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let alice: SignedIn;
let bob: SignedIn;
let profileId: string;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  alice = await signedIn(t.db, { username: "alice-subs" });
  bob = await signedIn(t.db, { username: "bob-subs" });
  profileId = (await seededDefault(t.db)).id;
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const base = "https://www.youtube.com/@BlenderOfficial";
const group = (name: string, url: string, ticked: boolean) => ({
  name,
  url,
  ticked,
  truncated: false,
  entries: [],
});

/** A channel preview the person is choosing from, as the probe leaves it. */
async function channelRequest(userId: string, sourceId = `UC${randomUUID()}`) {
  const row = await t.db
    .insertInto("download_requests")
    .values({
      user_id: userId,
      url: base,
      profile_id: profileId,
      state: "choosing",
      kind: "channel",
      title: "Blender",
      entries: JSON.stringify([
        group("Videos", `${base}/videos`, true),
        group("Shorts", `${base}/shorts`, false),
        group("Live", `${base}/streams`, false),
      ]),
      source_extractor: "youtube",
      source_id: sourceId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const send = (s: SignedIn, method: string, path: string, json?: unknown) =>
  h.app(s).request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });

async function subscribe(s: SignedIn, over: Record<string, unknown> = {}) {
  const requestId = await channelRequest(s.userId);
  const res = await post(h.app(s), "/api/subscriptions", {
    requestId,
    feeds: ["Videos"],
    profileId,
    schedule: { kind: "interval", minutes: 360 },
    ...over,
  });
  return res;
}

async function created(s: SignedIn, over: Record<string, unknown> = {}): Promise<Subscription> {
  const res = await subscribe(s, over);
  expect(res.status).toBe(201);
  return Subscription.parse(await res.json());
}

describe("subscriptions", () => {
  it("subscribes from a channel preview and schedules a check", async () => {
    const sub = await created(alice);
    expect(sub).toMatchObject({
      kind: "channel",
      title: "Blender",
      extractor: "youtube",
      feeds: [{ name: "Videos", url: `${base}/videos` }],
      schedule: { kind: "interval", minutes: 360 },
      enabled: true,
      backfill: { mode: "none", count: null },
    });
    expect(sub.tabs.map((f) => f.name)).toEqual(["Videos", "Shorts", "Live"]);
    expect(sub.channelKey).not.toBeNull();
    const scheduler = await h.queues.automation.getJobScheduler(sub.id);
    expect(scheduler?.every).toBe(21_600_000);
    const jobs = await h.queues.automation.getJobs(["waiting", "delayed", "prioritized"]);
    expect(jobs.some((j) => j.data.subscriptionId === sub.id)).toBe(true);
  });

  it("refuses a second subscription to the same channel (409)", async () => {
    const sourceId = `UC${randomUUID()}`;
    const first = await post(h.app(alice), "/api/subscriptions", {
      requestId: await channelRequest(alice.userId, sourceId),
      feeds: ["Videos"],
      profileId,
      schedule: { kind: "interval", minutes: 360 },
    });
    expect(first.status).toBe(201);
    const again = await post(h.app(alice), "/api/subscriptions", {
      requestId: await channelRequest(alice.userId, sourceId),
      feeds: ["Videos"],
      profileId,
      schedule: { kind: "interval", minutes: 360 },
    });
    expect(again.status).toBe(409);
    expect(ApiErrorBody.parse(await again.json()).message).toMatch(/already subscribed/);
  });

  it("refuses an interval under the minimum (400) and an unknown tab (400)", async () => {
    expect((await subscribe(alice, { schedule: { kind: "interval", minutes: 30 } })).status).toBe(
      400,
    );
    expect((await subscribe(alice, { feeds: ["Podcasts"] })).status).toBe(400);
  });

  it("checks on a cron in its timezone, and refuses a too-frequent, odd or unknown-zone cron", async () => {
    const cron = { kind: "cron", expression: "0  */6 * * *", timezone: "Europe/Berlin" };
    const sub = await created(alice, { schedule: cron });
    expect(sub.schedule).toEqual({ ...cron, expression: "0 */6 * * *" });
    expect(sub.nextCheckAt).not.toBeNull();
    const scheduler = await h.queues.automation.getJobScheduler(sub.id);
    expect(scheduler).toMatchObject({ pattern: "0 */6 * * *", tz: "Europe/Berlin" });
    for (const [expression, timezone, message] of [
      ["*/5 * * * *", "UTC", /runs every 5 minutes; the shortest allowed is 60 minutes/],
      ["0,1 9 * * *", "UTC", /runs every 1 minute/],
      ["0 0 9 * * *", "UTC", /5 fields/],
      ["0 99 * * *", "UTC", /not a valid cron/],
      ["0 9 * * *", "Mars/Olympus", /unknown timezone/],
    ] as const) {
      const res = await subscribe(alice, { schedule: { kind: "cron", expression, timezone } });
      expect([expression, res.status]).toEqual([expression, 400]);
      expect(ApiErrorBody.parse(await res.json()).message).toMatch(message);
    }
  });

  it("switches an interval subscription to a cron and back", async () => {
    const sub = await created(alice);
    const cron = { kind: "cron", expression: "30 7 * * 1", timezone: "UTC" };
    const res = await send(alice, "PATCH", `/api/subscriptions/${sub.id}`, { schedule: cron });
    expect(Subscription.parse(await res.json()).schedule).toEqual(cron);
    expect(await h.queues.automation.getJobScheduler(sub.id)).toMatchObject({
      pattern: "30 7 * * 1",
    });
    const back = await send(alice, "PATCH", `/api/subscriptions/${sub.id}`, {
      schedule: { kind: "interval", minutes: 720 },
    });
    expect(Subscription.parse(await back.json()).schedule).toEqual({
      kind: "interval",
      minutes: 720,
    });
    expect((await h.queues.automation.getJobScheduler(sub.id))?.every).toBe(43_200_000);
  });

  it("refuses an invalid title pattern (400)", async () => {
    const res = await subscribe(alice, { filters: { titleExclude: "((" } });
    expect(res.status).toBe(400);
  });

  it("refuses another person's request (404)", async () => {
    const requestId = await channelRequest(alice.userId);
    const res = await post(h.app(bob), "/api/subscriptions", {
      requestId,
      feeds: ["Videos"],
      profileId,
      schedule: { kind: "interval", minutes: 360 },
    });
    expect(res.status).toBe(404);
  });

  it("pausing removes the schedule and resuming restores it", async () => {
    const sub = await created(alice);
    const paused = await send(alice, "PATCH", `/api/subscriptions/${sub.id}`, { enabled: false });
    expect(Subscription.parse(await paused.json())).toMatchObject({
      enabled: false,
      nextCheckAt: null,
    });
    expect(await h.queues.automation.getJobScheduler(sub.id)).toBeUndefined();
    expect((await send(alice, "POST", `/api/subscriptions/${sub.id}/check`)).status).toBe(409);
    await send(alice, "PATCH", `/api/subscriptions/${sub.id}`, { enabled: true });
    expect((await h.queues.automation.getJobScheduler(sub.id))?.every).toBe(21_600_000);
    expect((await send(alice, "POST", `/api/subscriptions/${sub.id}/check`)).status).toBe(202);
  });

  it("follows another tab after an edit, and rewrites \\b in patterns", async () => {
    const sub = await created(alice, { filters: { titleExclude: "\\blive\\b" } });
    expect(sub.filters.titleExclude).toBe("\\ylive\\y");
    const res = await send(alice, "PATCH", `/api/subscriptions/${sub.id}`, {
      feeds: ["Videos", "Live"],
    });
    expect(Subscription.parse(await res.json()).feeds.map((f) => f.url)).toEqual([
      `${base}/videos`,
      `${base}/streams`,
    ]);
  });

  it("reconsiders filtered items when filters change", async () => {
    const sub = await created(alice);
    for (const [videoId, outcome] of [
      ["a", "filtered"],
      ["b", "queued"],
    ] as const) {
      await t.db
        .insertInto("subscription_items")
        .values({
          subscription_id: sub.id,
          extractor: "youtube",
          video_id: videoId,
          url: "u",
          outcome,
        })
        .execute();
    }
    await send(alice, "PATCH", `/api/subscriptions/${sub.id}`, { notify: false });
    expect(await outcomes(sub.id)).toEqual(["filtered", "queued"]);
    await send(alice, "PATCH", `/api/subscriptions/${sub.id}`, {
      filters: { minDuration: 60 },
    });
    expect(await outcomes(sub.id)).toEqual(["waiting", "queued"]);
  });

  it("unsubscribing cancels undispatched downloads and keeps entries", async () => {
    const sub = await created(alice);
    const waiting = await download(alice.userId, sub.id, null);
    const running = await download(alice.userId, sub.id, new Date());
    const entryId = await entry(alice.userId, sub.id);
    const res = await send(alice, "DELETE", `/api/subscriptions/${sub.id}`);
    expect(res.status).toBe(204);
    expect(await stateOf(waiting)).toBe("cancelled");
    expect(await stateOf(running)).toBe("queued");
    const kept = await t.db
      .selectFrom("library_entries")
      .select("subscription_id")
      .where("id", "=", entryId)
      .executeTakeFirstOrThrow();
    expect(kept.subscription_id).toBeNull();
    expect(await h.queues.automation.getJobScheduler(sub.id)).toBeUndefined();
  });

  it("another person's subscription is 404, and lists are one's own", async () => {
    const sub = await created(alice);
    expect((await send(bob, "GET", `/api/subscriptions/${sub.id}`)).status).toBe(404);
    expect(
      (await send(bob, "PATCH", `/api/subscriptions/${sub.id}`, { notify: false })).status,
    ).toBe(404);
    expect((await send(bob, "DELETE", `/api/subscriptions/${sub.id}`)).status).toBe(404);
    const listed = (await (await send(bob, "GET", "/api/subscriptions")).json()) as unknown[];
    expect(listed).toEqual([]);
  });

  it("lists recent activity, newest first", async () => {
    const sub = await created(alice);
    const at = (s: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, s));
    for (const [videoId, s] of [
      ["old", 1],
      ["new", 2],
    ] as const) {
      await t.db
        .insertInto("subscription_items")
        .values({
          subscription_id: sub.id,
          extractor: "youtube",
          video_id: videoId,
          url: "u",
          outcome: "filtered",
          reason: "title",
          seen_at: at(s),
        })
        .execute();
    }
    const page = SubscriptionItemsPage.parse(
      await (await send(alice, "GET", `/api/subscriptions/${sub.id}/items`)).json(),
    );
    expect(page.items.map((i) => [i.videoId, i.reason])).toEqual([
      ["new", "title"],
      ["old", "title"],
    ]);
    expect(page.nextCursor).toBeNull();
  });
});

async function outcomes(subscriptionId: string): Promise<string[]> {
  const rows = await t.db
    .selectFrom("subscription_items")
    .select("outcome")
    .where("subscription_id", "=", subscriptionId)
    .orderBy("video_id")
    .execute();
  return rows.map((r) => r.outcome);
}

async function download(userId: string, subscriptionId: string, dispatchedAt: Date | null) {
  const v = randomUUID();
  const row = await t.db
    .insertInto("downloads")
    .values({
      user_id: userId,
      profile_id: profileId,
      profile_revision: "rev",
      args: JSON.stringify({}),
      extractor: "youtube",
      video_id: v,
      url: `https://www.youtube.com/watch?v=${v}`,
      fetch_key: `fetch|youtube|${v}|p|rev`,
      subscription_id: subscriptionId,
      dispatched_at: dispatchedAt,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function stateOf(downloadId: string): Promise<string> {
  const row = await t.db
    .selectFrom("downloads")
    .select("state")
    .where("id", "=", downloadId)
    .executeTakeFirstOrThrow();
  return row.state;
}

async function entry(userId: string, subscriptionId: string): Promise<string> {
  const m = await t.db
    .insertInto("media")
    .values({ extractor: "youtube", video_id: randomUUID() })
    .returning("id")
    .executeTakeFirstOrThrow();
  const r = await t.db
    .insertInto("renditions")
    .values({
      media_id: m.id,
      profile_id: profileId,
      profile_revision: "rev",
      storage_key: `media/${m.id}`,
      size_bytes: 1,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const e = await t.db
    .insertInto("library_entries")
    .values({
      user_id: userId,
      media_id: m.id,
      rendition_id: r.id,
      subscription_id: subscriptionId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return e.id;
}
