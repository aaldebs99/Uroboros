import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queuedData } from "../../test/jobs.ts";
import type { FetchJob, NotifyJob } from "../downloads/queues.ts";
import { signedIn } from "../../test/auth.ts";
import { downloadScenario, fetchJob } from "../../test/fetchJobs.ts";
import { seededDefault } from "../../test/downloads.ts";
import { insertSubscription, listing } from "../../test/listings.ts";
import { listedNotices } from "../../test/notices.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { createCancelRegistry, fetchProcessor } from "../worker/fetch.ts";
import { checkProcessor } from "./check.ts";
import { downloadItem } from "./itemDownload.ts";
import { failedVideoNotice, failingNotice, newVideoNotice, newVideosNotice } from "./notices.ts";
import { noticeNewVideos } from "./videoNotices.ts";

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

/** Runs a subscription's check over a listing of `ids`, newest first. */
async function check(subscriptionId: string, url: string, ids: string[]) {
  const deps = await h.deps({
    steps: [
      {
        stdout: listing(
          url,
          ids.map((v) => ({ id: v })),
        ),
      },
    ],
  });
  await checkProcessor(deps)({ data: { subscriptionId } });
}

/** Runs the fetch a dispatch queued for `videoId`: the recorded clip, or a private video. */
async function settle(videoId: string, outcome: "done" | "failed" = "done") {
  const data = (await queuedData<FetchJob>(t.db, "download")).find((d) => d.videoId === videoId);
  if (data === undefined) throw new Error(`no fetch is queued for ${videoId}`);
  const deps = await h.deps(
    outcome === "done"
      ? await downloadScenario()
      : { steps: [{ stderr: "ERROR: [youtube] x: Private video\n" }], exitCode: 1 },
  );
  await fetchProcessor(deps, createCancelRegistry())(fetchJob(data)).catch(() => undefined);
}

/** The person's download of `videoId`, and its library entry once it has one. */
async function downloadOf(userId: string, videoId: string) {
  const d = await t.db
    .selectFrom("downloads as d")
    .leftJoin("library_entries as e", (j) =>
      j.onRef("e.rendition_id", "=", "d.rendition_id").onRef("e.user_id", "=", "d.user_id"),
    )
    .select(["d.id", "d.state", "e.id as entry_id"])
    .where("d.user_id", "=", userId)
    .where("d.video_id", "=", videoId)
    .executeTakeFirstOrThrow();
  return { id: d.id, state: d.state, entryId: d.entry_id ?? "" };
}

const primed = (url: string) => [{ name: "Videos", url, primedAt: new Date().toISOString() }];

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
    expect(newVideoNotice(sub, { downloadId: "d1", title: "One", entryId: "e1" })).toEqual({
      title: "New from Blender",
      body: "One",
      path: "/library/e1",
      tag: "subscription-video-d1",
    });
    expect(failedVideoNotice(sub, { downloadId: "d1", title: "One" })).toEqual({
      title: "New from Blender",
      body: "One: the download failed",
      path: "/downloads",
      tag: "subscription-video-d1",
    });
    expect(failingNotice(sub, "This channel does not exist.")).toEqual({
      title: "Blender: checks are failing",
      body: "This channel does not exist.",
      path: "/subscriptions/s1",
      tag: "subscription-s1",
    });
  });

  it("announces a new video once it is in the library, opening it, and never a backfill", async () => {
    const u = await signedIn(t.db, { username: "noticed" });
    const id = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      feeds: [{ name: "Videos", url: videos }],
      sourceId: "N1",
      backfill: "all",
    });
    await check(id, videos, ["n0", "n1"]);
    await check(id, videos, ["n2", "n0", "n1"]);
    // Queued, not downloaded yet: nothing to open, so nothing said.
    expect(await notices(u.userId)).toEqual([]);

    await settle("n2");
    const n2 = await downloadOf(u.userId, "n2");
    expect(n2).toMatchObject({ state: "done" });
    expect(n2.entryId).not.toBe("");
    const announced = {
      userId: u.userId,
      message: newVideoNotice(
        { id, title: "Blender" },
        { downloadId: n2.id, title: "Video n2", entryId: n2.entryId },
      ),
      urgency: "normal",
    };
    expect(await notices(u.userId)).toEqual([announced]);

    // The backfill is downloaded too, quietly; and a second look at n2 says nothing more.
    await settle("n0");
    expect((await downloadOf(u.userId, "n0")).state).toBe("done");
    await noticeNewVideos(await h.deps({ steps: [] }), [n2.id]);
    expect(await notices(u.userId)).toEqual([announced]);
  });

  it("announces at the check a new video already stored for someone else", async () => {
    const url = "https://www.youtube.com/@Stored/videos";
    const ann = await signedIn(t.db, { username: "storedann" });
    const ben = await signedIn(t.db, { username: "storedben" });
    const subOf = (userId: string) =>
      insertSubscription(t.db, { userId, profileId, feeds: primed(url), sourceId: "N4" });
    const annSub = await subOf(ann.userId);
    await check(annSub, url, ["s0"]);
    await settle("s0");
    expect(await notices(ann.userId)).toHaveLength(1);

    const benSub = await subOf(ben.userId);
    await check(benSub, url, ["s0"]);
    const s0 = await downloadOf(ben.userId, "s0");
    expect(s0).toMatchObject({ state: "done" });
    expect(await notices(ben.userId)).toEqual([
      {
        userId: ben.userId,
        message: newVideoNotice(
          { id: benSub, title: "Blender" },
          { downloadId: s0.id, title: "Video s0", entryId: s0.entryId },
        ),
        urgency: "normal",
      },
    ]);
  });

  it("says when a new video's download failed for good, opening Downloads", async () => {
    const url = "https://www.youtube.com/@Failing/videos";
    const u = await signedIn(t.db, { username: "faileddl" });
    const id = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      feeds: primed(url),
      sourceId: "N5",
    });
    await check(id, url, ["f0"]);
    await settle("f0", "failed");
    const f0 = await downloadOf(u.userId, "f0");
    expect(f0.state).toBe("failed");
    expect(await notices(u.userId)).toEqual([
      {
        userId: u.userId,
        message: failedVideoNotice(
          { id, title: "Blender" },
          { downloadId: f0.id, title: "Video f0" },
        ),
        urgency: "normal",
      },
    ]);
  });

  it("without auto-download, points at the subscription, and a video picked there says nothing", async () => {
    const url = "https://www.youtube.com/@Picking/videos";
    const u = await signedIn(t.db, { username: "picker" });
    const id = await insertSubscription(t.db, {
      userId: u.userId,
      profileId,
      feeds: primed(url),
      sourceId: "N6",
      columns: { auto_download: false },
    });
    await check(id, url, ["p0"]);
    const listed = [
      {
        userId: u.userId,
        message: newVideosNotice({ id, title: "Blender" }, ["Video p0"]),
        urgency: "normal",
      },
    ];
    expect(await notices(u.userId)).toEqual(listed);

    const deps = await h.deps({ steps: [] });
    await downloadItem(deps, u.userId, id, { extractor: "youtube", videoId: "p0" });
    await settle("p0");
    expect((await downloadOf(u.userId, "p0")).state).toBe("done");
    expect(await notices(u.userId)).toEqual(listed);
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
    await check(id, videos, ["q0"]);
    await settle("q0");
    const q0 = await downloadOf(u.userId, "q0");
    expect(await notices(u.userId)).toEqual([]);
    expect(await listedNotices(t.db, u.userId)).toMatchObject([
      { kind: "subscriptions", title: "New from Blender", path: `/library/${q0.entryId}` },
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
