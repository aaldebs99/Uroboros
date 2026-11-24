import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { downloadScenario, fetchJob, queuedFetch } from "../../test/fetchJobs.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { FetchJob } from "../downloads/queues.ts";
import { createCancelRegistry, fetchProcessor } from "./fetch.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let n = 0;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await workerHarness(testDb.db, 1);
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

const user = (): Promise<SignedIn> => signedIn(testDb.db, { username: `sk${String(++n)}` });

/** What yt-dlp's SponsorBlock step leaves in the info.json (the GTA VI video's segments). */
const sponsorblock_chapters = [
  { start_time: 49.04, end_time: 69, category: "sponsor", title: "Sponsor", type: "skip" },
  { start_time: 77.694, end_time: 88.43, category: "selfpromo", type: "skip" },
  { start_time: 120, end_time: 120, category: "poi_highlight", type: "poi" },
  { start_time: 0, end_time: 9, category: "intro", type: "skip" },
];

async function fetched(data: FetchJob) {
  const deps = await h.deps(await downloadScenario([], { sponsorblock_chapters }));
  await fetchProcessor(deps, createCancelRegistry())(fetchJob(data));
  return testDb.db
    .selectFrom("renditions")
    .select("skip_segments")
    .where("profile_id", "=", data.profileId)
    .where("media_id", "in", (eb) =>
      eb.selectFrom("media").select("id").where("video_id", "=", data.videoId),
    )
    .executeTakeFirstOrThrow();
}

describe("a fetch's SponsorBlock segments", () => {
  it("are kept on a video's rendition for the player to skip (the profile's categories only)", async () => {
    const data = await queuedFetch(testDb.db, "sb-video", [await user()]);
    expect(data.args.sponsorblockRemove).toEqual(["interaction", "selfpromo", "sponsor"]);
    expect((await fetched(data)).skip_segments).toEqual([
      { start: 49.04, end: 69, category: "sponsor" },
      { start: 77.694, end: 88.43, category: "selfpromo" },
    ]);
  });

  it("are none on an audio file's rendition: yt-dlp cut them out", async () => {
    const data = await queuedFetch(testDb.db, "sb-audio", [await user()]);
    const audio = { ...data, args: { ...data.args, audioOnly: true, audioFormat: "opus" } };
    expect((await fetched(audio)).skip_segments).toEqual([]);
  });
});
