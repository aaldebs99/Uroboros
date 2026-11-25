import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { eventually } from "../../test/eventually.ts";
import { fakeGate } from "../../test/fakeGate.ts";
import { insertSubscription, listing } from "../../test/listings.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { RequeueError } from "../jobs/errors.ts";
import { checkProcessor } from "./check.ts";
import { updateSubscription } from "./subscriptions.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let profileId: string;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db, 100);
  profileId = (await seededDefault(t.db)).id;
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const base = "https://www.youtube.com/@BlenderOfficial";
const videos = `${base}/videos`;
const streams = `${base}/streams`;
const loose = {
  titleInclude: null,
  titleExclude: null,
  minDuration: null,
  maxDuration: null,
  uploadedAfter: null,
  excludeShorts: false,
  excludeLive: false,
};

const row = (id: string) =>
  t.db.selectFrom("subscriptions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

/** Waits until a check holds the subscription's lease: it has read the row it decides under. */
const leased = (id: string) =>
  eventually(async () => {
    expect((await row(id)).lease_until).not.toBeNull();
  });

let gate: Awaited<ReturnType<typeof fakeGate>>;
beforeEach(async () => {
  gate = await fakeGate();
});
afterEach(async () => {
  await gate.close();
});

describe("edits made while a check runs", () => {
  it("keeps tab edits made while a check runs", async () => {
    const u = await signedIn(t.db, { username: "edit-tabs" });
    const id = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      feeds: [{ name: "Videos", url: videos }],
      sourceId: "E1",
    });
    await t.db
      .updateTable("subscriptions")
      .set({
        tabs: JSON.stringify([
          { name: "Videos", url: videos },
          { name: "Live", url: streams },
        ]),
      })
      .where("id", "=", id)
      .execute();
    const deps = await h.deps({
      steps: [gate.step, { stdout: listing(videos, [{ id: "e0" }]) }],
    });
    const running = checkProcessor(deps)({ data: { subscriptionId: id } });
    running.catch(() => undefined);
    await leased(id);
    await updateSubscription(h.ctx, u.userId, id, { feeds: ["Videos", "Live"] });
    await gate.go();
    await running;
    const feeds = (await row(id)).feeds;
    expect(feeds.map((f) => f.name)).toEqual(["Videos", "Live"]);
    expect(feeds[0]?.primedAt).toBeTruthy();
    expect(feeds[1]?.primedAt ?? null).toBeNull();
  });

  it("records nothing decided under filters edited mid-check, and checks again", async () => {
    const u = await signedIn(t.db, { username: "edit-filters" });
    const id = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      feeds: [{ name: "Videos", url: videos }],
      sourceId: "E2",
      backfill: "all",
      columns: { max_duration_s: 100 },
    });
    const deps = await h.deps({
      steps: [gate.step, { stdout: listing(videos, [{ id: "f0", duration: 300 }]) }],
    });
    const running = checkProcessor(deps)({ data: { subscriptionId: id } });
    running.catch(() => undefined);
    await leased(id);
    await updateSubscription(h.ctx, u.userId, id, { filters: loose });
    await gate.go();
    // Stale: the job goes back to the queue, unspent, to run again under the new filters.
    await expect(running).rejects.toBeInstanceOf(RequeueError);
    const items = await t.db
      .selectFrom("subscription_items")
      .select("outcome")
      .where("subscription_id", "=", id)
      .execute();
    expect(items).toEqual([]);
    expect((await row(id)).feeds[0]?.primedAt ?? null).toBeNull();
    // The re-check decides under the new filters, still as the backfill.
    await checkProcessor(
      await h.deps({ steps: [{ stdout: listing(videos, [{ id: "f0", duration: 300 }]) }] }),
    )({
      data: { subscriptionId: id },
    });
    const queued = await t.db
      .selectFrom("downloads")
      .select(["video_id", "priority"])
      .where("subscription_id", "=", id)
      .execute();
    expect(queued).toEqual([{ video_id: "f0", priority: 1 }]);
  });
});
