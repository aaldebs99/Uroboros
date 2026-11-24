import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { insertSubscription, listing } from "../../test/listings.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { latestProcessor, SubscriptionBusy } from "./latest.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let profileId: string;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db);
  profileId = (await seededDefault(t.db)).id;
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const base = "https://www.youtube.com/@BlenderOfficial";
const videos = `${base}/videos`;
const streams = `${base}/streams`;
const user = (): Promise<SignedIn> => signedIn(t.db, { username: `l${String(++n)}` });
const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${String(i)}` }));

const queued = (subscriptionId: string) =>
  t.db
    .selectFrom("downloads")
    .select(["video_id", "priority"])
    .where("subscription_id", "=", subscriptionId)
    .orderBy("video_id")
    .execute();

const outcomes = (subscriptionId: string) =>
  t.db
    .selectFrom("subscription_items")
    .select(["video_id", "outcome"])
    .where("subscription_id", "=", subscriptionId)
    .orderBy("video_id")
    .execute();

async function run(subscriptionId: string, count: number, scenario: Parameters<typeof h.deps>[0]) {
  await latestProcessor(await h.deps(scenario))({ data: { subscriptionId, count } });
}

describe("download the latest", () => {
  it("queues a channel's newest N of each followed tab, past its filters, at priority 0", async () => {
    const u = await user();
    const sub = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      sourceId: `LC${String(n)}`,
      feeds: [
        { name: "Videos", url: videos },
        { name: "Live", url: streams },
      ],
      // A filter that would hold everything back: asked for, they come anyway.
      columns: { title_include: "^nothing-matches$" },
    });
    await t.db
      .insertInto("subscription_items")
      .values({
        subscription_id: sub,
        extractor: "youtube",
        video_id: "v0",
        title: "Video v0",
        url: "https://www.youtube.com/watch?v=v0",
        outcome: "existing",
        reason: "there when you subscribed",
      })
      .execute();
    await run(sub, 2, {
      steps: [],
      variants: [
        { whenArg: videos, steps: [{ stdout: listing(videos, ids("v", 2)) }] },
        { whenArg: streams, steps: [{ stdout: listing(streams, ids("s", 2)) }] },
      ],
    });
    expect(await queued(sub)).toEqual(
      ["s0", "s1", "v0", "v1"].map((video_id) => ({ video_id, priority: 0 })),
    );
    expect((await outcomes(sub)).map((o) => o.outcome)).toEqual([
      "queued",
      "queued",
      "queued",
      "queued",
    ]);
    // Each tab was listed only as far as asked.
    expect(await h.lastArgv()).toContain("--playlist-items=1:2");
  });

  it("takes a playlist's last N entries, and gets nothing twice", async () => {
    const u = await user();
    const pl = "https://www.youtube.com/playlist?list=PLlatest";
    const sub = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      sourceId: `LP${String(n)}`,
      feeds: [{ name: "Playlist", url: pl }],
      columns: { kind: "playlist" },
    });
    const scenario = { steps: [{ stdout: listing(pl, ids("p", 5)) }] };
    await run(sub, 2, scenario);
    expect((await queued(sub)).map((d) => d.video_id)).toEqual(["p3", "p4"]);
    await run(sub, 3, scenario);
    // p3 and p4 are already on their way: only p2 is new.
    expect((await queued(sub)).map((d) => d.video_id)).toEqual(["p2", "p3", "p4"]);
  });

  it("tries again later while a check holds the subscription, and leaves a paused one alone", async () => {
    const u = await user();
    const sub = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      sourceId: `LB${String(n)}`,
      feeds: [{ name: "Videos", url: videos }],
    });
    await t.db
      .updateTable("subscriptions")
      .set({ lease_until: new Date(Date.now() + 60_000) })
      .where("id", "=", sub)
      .execute();
    const deps = await h.deps({ steps: [{ stdout: listing(videos, ids("b", 1)) }] });
    await expect(
      latestProcessor(deps)({ data: { subscriptionId: sub, count: 1 } }),
    ).rejects.toThrow(SubscriptionBusy);
    await t.db
      .updateTable("subscriptions")
      .set({ lease_until: null, enabled: false })
      .where("id", "=", sub)
      .execute();
    await latestProcessor(deps)({ data: { subscriptionId: sub, count: 1 } });
    expect(await queued(sub)).toEqual([]);
  });
});
