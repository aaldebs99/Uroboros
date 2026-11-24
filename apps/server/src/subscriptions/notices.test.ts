import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queuedData } from "../../test/jobs.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import { signedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { insertSubscription, listing } from "../../test/listings.ts";
import { listedNotices } from "../../test/notices.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { checkProcessor } from "./check.ts";
import { failingNotice, newVideosNotice } from "./notices.ts";

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

const videos = "https://www.youtube.com/@BlenderOfficial/videos";
const sub = { id: "s1", title: "Blender" };

async function notices(userId: string) {
  const jobs = await queuedData<NotifyJob>(t.db, "notify");
  return jobs.filter((d) => d.userId === userId);
}

describe("subscription notices", () => {
  it("words new videos and failures", () => {
    expect(newVideosNotice(sub, ["One"])).toEqual({
      title: "New from Blender",
      body: "One",
      path: "/subscriptions/s1",
      tag: "subscription-s1",
    });
    expect(newVideosNotice(sub, ["A", "B", "C", "D"])).toMatchObject({
      title: "4 new videos from Blender",
      body: "A\nB\nC",
    });
    expect(failingNotice(sub, "This channel does not exist.")).toEqual({
      title: "Blender: checks are failing",
      body: "This channel does not exist.",
      path: "/subscriptions/s1",
      tag: "subscription-s1",
    });
  });

  it("notifies new videos after the first check, not for a backfill", async () => {
    const u = await signedIn(t.db, { username: "noticed" });
    const id = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      feeds: [{ name: "Videos", url: videos }],
      sourceId: "N1",
      backfill: "all",
    });
    const run = async (ids: string[]) => {
      const deps = await h.deps({
        steps: [
          {
            stdout: listing(
              videos,
              ids.map((v) => ({ id: v })),
            ),
          },
        ],
      });
      await checkProcessor(deps)({ data: { subscriptionId: id } });
    };
    await run(["n0", "n1"]);
    expect(await notices(u.userId)).toEqual([]);
    await run(["n2", "n0", "n1"]);
    expect(await notices(u.userId)).toEqual([
      {
        userId: u.userId,
        message: newVideosNotice({ id, title: "Blender" }, ["Video n2"]),
        urgency: "normal",
      },
    ]);
  });

  it("pushes nothing when the person turned its notices off, but lists them", async () => {
    const u = await signedIn(t.db, { username: "quiet" });
    const id = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      feeds: [{ name: "Videos", url: videos, primedAt: new Date().toISOString() }],
      sourceId: "N2",
      notify: false,
    });
    const deps = await h.deps({ steps: [{ stdout: listing(videos, [{ id: "q0" }]) }] });
    await checkProcessor(deps)({ data: { subscriptionId: id } });
    expect(await notices(u.userId)).toEqual([]);
    expect(await listedNotices(t.db, u.userId)).toMatchObject([
      { kind: "subscriptions", title: "New from Blender", path: `/subscriptions/${id}` },
    ]);
  });

  it("notifies once when checks start failing", async () => {
    const u = await signedIn(t.db, { username: "failing" });
    const id = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      feeds: [{ name: "Videos", url: videos }],
      sourceId: "N3",
    });
    const deps = await h.deps({
      steps: [{ stderr: "ERROR: [youtube:tab] @gone: This channel does not exist.\n" }],
      exitCode: 1,
    });
    for (let i = 0; i < 4; i++) await checkProcessor(deps)({ data: { subscriptionId: id } });
    const sent = await notices(u.userId);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      urgency: "high",
      message: { title: "Blender: checks are failing", tag: `subscription-${id}` },
    });
  });
});
