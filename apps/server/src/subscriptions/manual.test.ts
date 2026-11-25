import { Subscription } from "@uroboros/contract";
import type { Scenario } from "@uroboros/ytdlp/testing";
import type { Insertable } from "kysely";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { post, seededDefault } from "../../test/downloads.ts";
import { liveJobs, queuedData } from "../../test/jobs.ts";
import { insertSubscription, listing, storedNextCheck } from "../../test/listings.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { SubscriptionsTable } from "../db/schema.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import { checkProcessor } from "./check.ts";

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

let n = 0;
const user = (): Promise<SignedIn> => signedIn(t.db, { username: `manual${String(++n)}` });

/** A channel preview the person is choosing from, as the probe leaves it. */
async function preview(userId: string): Promise<string> {
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
        { name: "Videos", url: videos, ticked: true, truncated: false, entries: [] },
      ]),
      source_extractor: "youtube",
      source_id: `UC${randomUUID()}`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const send = async (s: SignedIn, method: string, path: string, json?: unknown) =>
  h.app(s).request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });

const edit = async (s: SignedIn, id: string, patch: unknown): Promise<Subscription> => {
  const res = await send(s, "PATCH", `/api/subscriptions/${id}`, patch);
  expect(res.status).toBe(200);
  return Subscription.parse(await res.json());
};

/** A subscription whose Videos tab was already primed, so what a check lists is new. */
async function primed(userId: string, columns: Partial<Insertable<SubscriptionsTable>>) {
  return insertSubscription(t.db, {
    userId,
    profileId,
    feeds: [{ name: "Videos", url: videos, primedAt: "2026-11-01T00:00:00.000Z" }],
    sourceId: `UC${randomUUID()}`,
    columns,
  });
}

async function check(id: string, scenario: Scenario) {
  await checkProcessor(await h.deps(scenario))({ data: { subscriptionId: id } });
}

const items = (id: string) =>
  t.db
    .selectFrom("subscription_items")
    .select(["video_id", "outcome", "download_id"])
    .where("subscription_id", "=", id)
    .orderBy("video_id")
    .execute();

const downloads = (id: string) =>
  t.db.selectFrom("downloads").select("video_id").where("subscription_id", "=", id).execute();

async function notices(userId: string): Promise<NotifyJob[]> {
  return (await queuedData<NotifyJob>(t.db, "notify")).filter((d) => d.userId === userId);
}

describe("a Manually schedule", () => {
  it("takes stock once when made, then never checks by itself, but checks when asked", async () => {
    const s = await user();
    const res = await post(h.app(s), "/api/subscriptions", {
      requestId: await preview(s.userId),
      feeds: ["Videos"],
      profileId,
      schedule: { kind: "manual" },
    });
    expect(res.status).toBe(201);
    const sub = Subscription.parse(await res.json());
    expect(sub).toMatchObject({ schedule: { kind: "manual" }, nextCheckAt: null });
    const checks = async () =>
      (await liveJobs(t.db, "automation")).filter((j) => j.key === `check|${sub.id}`);
    expect(await checks()).toHaveLength(1);
    expect(await storedNextCheck(t.db, sub.id)).toBeNull();
    await t.db.deleteFrom("jobs").where("key", "=", `check|${sub.id}`).execute();

    expect((await send(s, "POST", `/api/subscriptions/${sub.id}/check`)).status).toBe(202);
    expect(await checks()).toHaveLength(1);
  });

  it("drops the next check when switched to, and stays unscheduled across a pause", async () => {
    const s = await user();
    const res = await post(h.app(s), "/api/subscriptions", {
      requestId: await preview(s.userId),
      feeds: ["Videos"],
      profileId,
      schedule: { kind: "interval", minutes: 360 },
    });
    const sub = Subscription.parse(await res.json());
    expect(sub.nextCheckAt).not.toBeNull();
    expect((await edit(s, sub.id, { schedule: { kind: "manual" } })).nextCheckAt).toBeNull();
    expect(await storedNextCheck(t.db, sub.id)).toBeNull();
    await edit(s, sub.id, { enabled: false });
    const resumed = await edit(s, sub.id, { enabled: true });
    expect(resumed).toMatchObject({
      enabled: true,
      schedule: { kind: "manual" },
      nextCheckAt: null,
    });
    expect(await storedNextCheck(t.db, sub.id)).toBeNull();
  });
});

describe("auto-download off", () => {
  it("is on unless asked, and can be turned off and on", async () => {
    const s = await user();
    const res = await post(h.app(s), "/api/subscriptions", {
      requestId: await preview(s.userId),
      feeds: ["Videos"],
      profileId,
      schedule: { kind: "manual" },
      autoDownload: false,
    });
    const sub = Subscription.parse(await res.json());
    expect(sub.autoDownload).toBe(false);
    expect((await edit(s, sub.id, { autoDownload: true })).autoDownload).toBe(true);
    const other = Subscription.parse(
      await (
        await post(h.app(s), "/api/subscriptions", {
          requestId: await preview(s.userId),
          feeds: ["Videos"],
          profileId,
          schedule: { kind: "manual" },
        })
      ).json(),
    );
    expect(other.autoDownload).toBe(true);
  });

  it("leaves new videos to pick, skips the wait, and still says they're there", async () => {
    const s = await user();
    const id = await primed(s.userId, { auto_download: false, delay_hours: 24 });
    await check(id, { steps: [{ stdout: listing(videos, [{ id: "new1" }, { id: "new2" }]) }] });
    expect(await items(id)).toEqual([
      { video_id: "new1", outcome: "new", download_id: null },
      { video_id: "new2", outcome: "new", download_id: null },
    ]);
    expect(await downloads(id)).toEqual([]);
    expect((await notices(s.userId)).map((j) => j.message.title)).toEqual([
      "2 new videos from Blender",
    ]);
  });

  it("leaves a first check's backfill to pick too, without a notice", async () => {
    const s = await user();
    const id = await insertSubscription(t.db, {
      userId: s.userId,
      profileId,
      feeds: [{ name: "Videos", url: videos }],
      sourceId: `UC${randomUUID()}`,
      backfill: "all",
      columns: { auto_download: false },
    });
    await check(id, { steps: [{ stdout: listing(videos, [{ id: "old1" }]) }] });
    expect(await items(id)).toEqual([{ video_id: "old1", outcome: "new", download_id: null }]);
    expect(await downloads(id)).toEqual([]);
    expect(await notices(s.userId)).toEqual([]);
  });

  it("keeps what it left as new when auto-download is turned back on", async () => {
    const s = await user();
    const id = await primed(s.userId, { auto_download: false });
    await check(id, { steps: [{ stdout: listing(videos, [{ id: "kept1" }]) }] });
    await t.db
      .updateTable("subscriptions")
      .set({ auto_download: true })
      .where("id", "=", id)
      .execute();
    await check(id, {
      steps: [{ stdout: listing(videos, [{ id: "next1" }, { id: "kept1" }]) }],
    });
    expect((await items(id)).map((i) => [i.video_id, i.outcome])).toEqual([
      ["kept1", "new"],
      ["next1", "queued"],
    ]);
    expect((await downloads(id)).map((d) => d.video_id)).toEqual(["next1"]);
  });
});
