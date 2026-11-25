import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { downloadScenario, fetchJob, queuedFetch } from "../../test/fetchJobs.ts";
import { fakeSponsorBlock } from "../../test/sponsorBlock.ts";
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

/** What SponsorBlock answers for the video: one segment of each of three categories. */
const FOUND = [
  { start: 0, end: 9, category: "intro" as const },
  { start: 49.04, end: 69, category: "sponsor" as const },
  { start: 77.694, end: 88.43, category: "selfpromo" as const },
];

/** A queued fetch of a YouTube video (the helper queues a generic link). */
const youtube = async (videoId: string): Promise<FetchJob> => ({
  ...(await queuedFetch(testDb.db, videoId, [await user()])),
  extractor: "youtube",
});

/** Fetches `data` with SponsorBlock answering `sb`; the rendition's stored segments and highlight. */
async function fetched(data: FetchJob, sb: ReturnType<typeof fakeSponsorBlock>) {
  const deps = { ...(await h.deps(await downloadScenario())), sponsorBlock: sb };
  await fetchProcessor(deps, createCancelRegistry())(fetchJob(data));
  const row = await testDb.db
    .selectFrom("renditions")
    .select(["skip_segments", "sponsor_highlight"])
    .where("profile_id", "=", data.profileId)
    .where("media_id", "in", (eb) =>
      eb.selectFrom("media").select("id").where("video_id", "=", data.videoId),
    )
    .executeTakeFirstOrThrow();
  const download = await testDb.db
    .selectFrom("downloads")
    .select("state")
    .where("fetch_key", "=", data.fetchKey)
    .executeTakeFirstOrThrow();
  return { segments: row.skip_segments, highlight: row.sponsor_highlight, state: download.state };
}

describe("a fetch's SponsorBlock segments (docs/automation.md#sponsorblock)", () => {
  it("are every category SponsorBlock has for a YouTube video, with its highlight, asked by the server itself", async () => {
    const data = await youtube("sb-video");
    const sb = fakeSponsorBlock({ "sb-video": { segments: FOUND, highlight: 42.5 } });
    expect(await fetched(data, sb)).toEqual({ segments: FOUND, highlight: 42.5, state: "done" });
    expect(sb.asked).toEqual(["sb-video"]);
    // With the stored file's own length, so segments from another cut of the video are dropped.
    expect(sb.durations).toEqual([expect.any(Number)]);
  });

  it("are kept for an audio-only download too: nothing is cut from the file", async () => {
    const data = await youtube("sb-audio");
    const audio = { ...data, args: { ...data.args, audioOnly: true, audioFormat: "opus" } };
    expect((await fetched(audio, fakeSponsorBlock({ "sb-audio": FOUND }))).segments).toEqual(FOUND);
  });

  it("are none when SponsorBlock fails, and the download still finishes", async () => {
    const data = await youtube("sb-down");
    const sb = fakeSponsorBlock({ "sb-down": new Error("SponsorBlock answered 503") });
    expect(await fetched(data, sb)).toEqual({ segments: [], highlight: null, state: "done" });
  });

  it("are never asked for a site SponsorBlock doesn't cover", async () => {
    const data = await queuedFetch(testDb.db, "sb-generic", [await user()]);
    const sb = fakeSponsorBlock({ "sb-generic": FOUND });
    expect((await fetched(data, sb)).segments).toEqual([]);
    expect(sb.asked).toEqual([]);
  });

  it("are never asked when the extra arguments cut the file", async () => {
    const data = await youtube("sb-cut");
    const cut = { ...data, args: { ...data.args, extraArgs: ["--remove-chapters", "Intro"] } };
    const sb = fakeSponsorBlock({ "sb-cut": FOUND });
    expect((await fetched(cut, sb)).segments).toEqual([]);
    expect(sb.asked).toEqual([]);
  });
});
