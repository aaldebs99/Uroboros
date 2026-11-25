import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { testBus } from "../../test/bus.ts";
import { seedDownloadedEntry } from "../../test/library.ts";
import { fakeSponsorBlock } from "../../test/sponsorBlock.ts";
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

const segmentsOf = async (renditionId: string) =>
  (
    await testDb.db
      .selectFrom("renditions")
      .select("skip_segments")
      .where("id", "=", renditionId)
      .executeTakeFirstOrThrow()
  ).skip_segments;

const highlightOf = async (renditionId: string) =>
  (
    await testDb.db
      .selectFrom("renditions")
      .select("sponsor_highlight")
      .where("id", "=", renditionId)
      .executeTakeFirstOrThrow()
  ).sponsor_highlight;

const OLD = [{ start: 1, end: 2, category: "sponsor" }];
const OLD_HIGHLIGHT = 5;

async function withOldSegments(renditionId: string) {
  await testDb.db
    .updateTable("renditions")
    .set({ skip_segments: JSON.stringify(OLD), sponsor_highlight: OLD_HIGHLIGHT })
    .where("id", "=", renditionId)
    .execute();
}

/** Deps whose yt-dlp must never run, asking `sponsorBlock` instead. */
const depsWith = async (sponsorBlock: ReturnType<typeof fakeSponsorBlock>) => ({
  ...(await h.deps({ steps: [] })),
  sponsorBlock,
});

let vid = 0;
const videoId = () => `rsvid${String(++vid)}`;

describe("refetching a video's SponsorBlock segments (docs/automation.md#sponsorblock)", () => {
  it("puts SponsorBlock's segments on the file and tells the asker how many they see", async () => {
    const u = await user();
    const id = videoId();
    const e = await seedDownloadedEntry(testDb.db, u.userId, { videoId: id });
    // The seeded file has no video stream, so the asker's audio choice counts.
    await testDb.db
      .insertInto("user_preferences")
      .values({
        user_id: u.userId,
        sponsorblock_audio_show: ["sponsor"],
        sponsorblock_audio_skip: ["sponsor"],
      })
      .execute();
    const found = [
      { start: 0, end: 9, category: "intro" as const },
      { start: 49.04, end: 69, category: "sponsor" as const },
    ];
    const sb = fakeSponsorBlock({ [id]: { segments: found, highlight: 30 } });
    await refetchSkipsProcessor(await depsWith(sb))({
      data: { entryId: e.entryId, userId: u.userId },
    });
    expect(sb.asked).toEqual([id]);
    // With the file's length (the seeded media's 100 s), as the fetch asks.
    expect(sb.durations).toEqual([100]);
    // Every category is stored, the highlight beside them; the asker's setting only decides what
    // they hear about, and the highlight isn't counted.
    expect(await segmentsOf(e.renditionId)).toEqual(found);
    expect(await highlightOf(e.renditionId)).toBe(30);
    // yt-dlp never ran: the lookup is the server's own.
    await expect(h.lastArgv()).rejects.toThrow();
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

  it("finds none when SponsorBlock has none (no highlight either), and says so", async () => {
    const u = await user();
    const e = await seedDownloadedEntry(testDb.db, u.userId, { videoId: videoId() });
    await withOldSegments(e.renditionId);
    await refetchSkipsProcessor(await depsWith(fakeSponsorBlock()))({
      data: { entryId: e.entryId, userId: u.userId },
    });
    expect(await segmentsOf(e.renditionId)).toEqual([]);
    expect(await highlightOf(e.renditionId)).toBeNull();
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

  it("keeps the old segments and highlight when SponsorBlock fails, and says why", async () => {
    const u = await user();
    const id = videoId();
    const e = await seedDownloadedEntry(testDb.db, u.userId, { videoId: id });
    await withOldSegments(e.renditionId);
    const sb = fakeSponsorBlock({ [id]: new Error("SponsorBlock answered 503") });
    await refetchSkipsProcessor(await depsWith(sb))({
      data: { entryId: e.entryId, userId: u.userId },
    });
    expect(await segmentsOf(e.renditionId)).toEqual(OLD);
    expect(await highlightOf(e.renditionId)).toBe(OLD_HIGHLIGHT);
    await expect
      .poll(() => heard)
      .toContainEqual({
        kind: "skips",
        userId: u.userId,
        entryId: e.entryId,
        found: null,
        error: "SponsorBlock answered 503",
      });
  });

  it("does nothing for an entry that is gone, or someone else's", async () => {
    const [u, other] = [await user(), await user()];
    const e = await seedDownloadedEntry(testDb.db, u.userId, { videoId: videoId() });
    await withOldSegments(e.renditionId);
    const sb = fakeSponsorBlock();
    const deps = await depsWith(sb);
    await refetchSkipsProcessor(deps)({ data: { entryId: e.entryId, userId: other.userId } });
    await testDb.db.deleteFrom("library_entries").where("id", "=", e.entryId).execute();
    await refetchSkipsProcessor(deps)({ data: { entryId: e.entryId, userId: u.userId } });
    expect(await segmentsOf(e.renditionId)).toEqual(OLD);
    expect(sb.asked).toEqual([]);
    expect(heard.some((x) => (x as { entryId: string }).entryId === e.entryId)).toBe(false);
  });
});
