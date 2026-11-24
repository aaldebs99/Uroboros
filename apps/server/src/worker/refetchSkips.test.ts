import type { Scenario } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { testBus } from "../../test/bus.ts";
import { seedDownloadedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { PgBus } from "../db/notifications.ts";
import { refetchSkipsProcessor } from "./refetchSkips.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let bus: PgBus;
let n = 0;
/** Every `skips` event heard on the downloads channel. */
const heard: unknown[] = [];

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await workerHarness(testDb.db, 1);
  bus = testBus(testDb);
  await bus.ready;
  bus.on("uroboros_downloads", (payload) => {
    const e = JSON.parse(payload) as { kind: string };
    if (e.kind === "skips") heard.push(e);
  });
});
afterAll(async () => {
  await bus.close();
  await h.close();
  await testDb.close();
});

const user = (): Promise<SignedIn> => signedIn(testDb.db, { username: `rs${String(++n)}` });

/** yt-dlp's probe of the video with SponsorBlock asked: these segments, or no key at all. */
const probed = (sponsorblock_chapters?: unknown[]): Scenario => ({
  steps: [
    {
      stdout: JSON.stringify({
        id: "x",
        extractor: "youtube",
        extractor_key: "Youtube",
        title: "A video",
        duration: 1008,
        ...(sponsorblock_chapters === undefined ? {} : { sponsorblock_chapters }),
      }),
    },
  ],
});

const segmentsOf = async (renditionId: string) =>
  (
    await testDb.db
      .selectFrom("renditions")
      .select("skip_segments")
      .where("id", "=", renditionId)
      .executeTakeFirstOrThrow()
  ).skip_segments;

const OLD = [{ start: 1, end: 2, category: "sponsor" }];

async function withOldSegments(renditionId: string) {
  await testDb.db
    .updateTable("renditions")
    .set({ skip_segments: JSON.stringify(OLD) })
    .where("id", "=", renditionId)
    .execute();
}

describe("refetching a video's SponsorBlock segments", () => {
  it("replaces the file's segments with SponsorBlock's, by the profile's categories", async () => {
    const u = await user();
    const e = await seedDownloadedEntry(testDb.db, u.userId, {
      args: { sponsorblockRemove: ["sponsor"] },
    });
    const deps = await h.deps(
      probed([
        { start_time: 49.04, end_time: 69, category: "sponsor", type: "skip" },
        { start_time: 77.694, end_time: 88.43, category: "selfpromo", type: "skip" },
        { start_time: 120, end_time: 120, category: "poi_highlight", type: "poi" },
      ]),
    );
    await refetchSkipsProcessor(deps)({ data: { entryId: e.entryId, userId: u.userId } });
    expect(await segmentsOf(e.renditionId)).toEqual([
      { start: 49.04, end: 69, category: "sponsor" },
    ]);
    const argv = await h.lastArgv();
    expect(argv).toContain("--sponsorblock-mark=sponsor");
    expect(argv).toContain(e.url);
    await expect
      .poll(() => heard)
      .toContainEqual({
        kind: "skips",
        userId: u.userId,
        entryId: e.entryId,
        found: 1,
        error: null,
      });
  });

  it("finds none when SponsorBlock has none, and says so", async () => {
    const u = await user();
    const e = await seedDownloadedEntry(testDb.db, u.userId);
    await withOldSegments(e.renditionId);
    await refetchSkipsProcessor(await h.deps(probed([])))({
      data: { entryId: e.entryId, userId: u.userId },
    });
    expect(await segmentsOf(e.renditionId)).toEqual([]);
    await expect
      .poll(() => heard)
      .toContainEqual({
        kind: "skips",
        userId: u.userId,
        entryId: e.entryId,
        found: 0,
        error: null,
      });
  });

  it("keeps the old segments when yt-dlp fails, and says why", async () => {
    const u = await user();
    const e = await seedDownloadedEntry(testDb.db, u.userId);
    await withOldSegments(e.renditionId);
    const failing: Scenario = {
      steps: [{ stderr: "ERROR: Unable to communicate with SponsorBlock API: HTTP Error 503\n" }],
      exitCode: 1,
    };
    await refetchSkipsProcessor(await h.deps(failing))({
      data: { entryId: e.entryId, userId: u.userId },
    });
    expect(await segmentsOf(e.renditionId)).toEqual(OLD);
    await expect
      .poll(() => heard)
      .toContainEqual(
        expect.objectContaining({ kind: "skips", entryId: e.entryId, found: null }) as unknown,
      );
    const failed = heard.find((x) => (x as { entryId: string }).entryId === e.entryId) as {
      error: string | null;
    };
    expect(failed.error).not.toBeNull();
  });

  it("keeps the old segments when yt-dlp never asked SponsorBlock", async () => {
    const u = await user();
    const e = await seedDownloadedEntry(testDb.db, u.userId);
    await withOldSegments(e.renditionId);
    await refetchSkipsProcessor(await h.deps(probed()))({
      data: { entryId: e.entryId, userId: u.userId },
    });
    expect(await segmentsOf(e.renditionId)).toEqual(OLD);
    await expect
      .poll(() => heard)
      .toContainEqual({
        kind: "skips",
        userId: u.userId,
        entryId: e.entryId,
        found: null,
        error: "SponsorBlock was not asked about this video",
      });
  });

  it("does nothing for an entry that is gone, or someone else's", async () => {
    const [u, other] = [await user(), await user()];
    const e = await seedDownloadedEntry(testDb.db, u.userId);
    await withOldSegments(e.renditionId);
    const deps = await h.deps(probed([]));
    await refetchSkipsProcessor(deps)({ data: { entryId: e.entryId, userId: other.userId } });
    await testDb.db.deleteFrom("library_entries").where("id", "=", e.entryId).execute();
    await refetchSkipsProcessor(deps)({ data: { entryId: e.entryId, userId: u.userId } });
    expect(await segmentsOf(e.renditionId)).toEqual(OLD);
    expect(heard.some((x) => (x as { entryId: string }).entryId === e.entryId)).toBe(false);
  });
});
