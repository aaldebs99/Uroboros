import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SponsorBlockStub } from "../../test/sponsorBlock.ts";
import { SponsorBlockError, sponsorBlockClient } from "./client.ts";

let stub: SponsorBlockStub;
beforeAll(async () => {
  stub = await SponsorBlockStub.start();
});
afterAll(async () => {
  await stub.close();
});

const VIDEO = "dQw4w9WgXcQ";
const prefix = createHash("sha256").update(VIDEO).digest("hex").slice(0, 4);

const entry = (videoID: string, segments: unknown[]) => ({ videoID, segments });
const seg = (
  segment: [number, number],
  category: string,
  actionType = "skip",
  videoDuration?: number,
) => ({
  segment,
  category,
  actionType,
  UUID: "u",
  ...(videoDuration === undefined ? {} : { videoDuration }),
});

describe("asking SponsorBlock for a video's segments (docs/automation.md#sponsorblock)", () => {
  it("asks by the hash prefix, with the eight categories and the skip action", async () => {
    stub.answer({ status: 200, body: [entry(VIDEO, [seg([1, 2], "sponsor")])] });
    await sponsorBlockClient({ baseUrl: stub.baseUrl }).segments(VIDEO, null);
    const ask = stub.asked.at(-1);
    expect(ask?.path).toBe(`/api/skipSegments/${prefix}`);
    expect(ask?.query.get("service")).toBe("YouTube");
    expect(JSON.parse(ask?.query.get("categories") ?? "[]")).toEqual([
      "sponsor",
      "intro",
      "outro",
      "selfpromo",
      "preview",
      "filler",
      "interaction",
      "music_offtopic",
    ]);
    expect(JSON.parse(ask?.query.get("actionTypes") ?? "[]")).toEqual(["skip"]);
  });

  it("keeps only the asked video's segments: the prefix matches others too", async () => {
    stub.answer({
      status: 200,
      body: [entry("someoneElse", [seg([5, 6], "sponsor")]), entry(VIDEO, [seg([3, 4], "intro")])],
    });
    expect(await sponsorBlockClient({ baseUrl: stub.baseUrl }).segments(VIDEO, null)).toEqual([
      { start: 3, end: 4, category: "intro" },
    ]);
  });

  it("answers [] when SponsorBlock has none (404)", async () => {
    stub.answer({ status: 404 });
    expect(await sponsorBlockClient({ baseUrl: stub.baseUrl }).segments(VIDEO, null)).toEqual([]);
  });

  it("fails on a server error and on a timeout", async () => {
    stub.answer({ status: 500, body: "oops" });
    await expect(
      sponsorBlockClient({ baseUrl: stub.baseUrl }).segments(VIDEO, null),
    ).rejects.toThrow(SponsorBlockError);
    stub.answer({ status: 200, body: [], delayMs: 500 });
    await expect(
      sponsorBlockClient({ baseUrl: stub.baseUrl, timeoutMs: 50 }).segments(VIDEO, null),
    ).rejects.toThrow(SponsorBlockError);
  });

  it("drops unknown categories, other actions and empty spans, sorted by start", async () => {
    stub.answer({
      status: 200,
      body: [
        entry(VIDEO, [
          seg([30, 40], "selfpromo"),
          seg([10, 20], "sponsor"),
          seg([50, 50], "sponsor"),
          seg([60, 60], "poi_highlight", "poi"),
          seg([70, 80], "exclusive_access", "full"),
          seg([90, 95], "filler", "mute"),
        ]),
      ],
    });
    expect(await sponsorBlockClient({ baseUrl: stub.baseUrl }).segments(VIDEO, null)).toEqual([
      { start: 10, end: 20, category: "sponsor" },
      { start: 30, end: 40, category: "selfpromo" },
    ]);
  });

  it("fails on an answer it can't read", async () => {
    stub.answer({ status: 200, body: { not: "a list" } });
    await expect(
      sponsorBlockClient({ baseUrl: stub.baseUrl }).segments(VIDEO, null),
    ).rejects.toThrow(SponsorBlockError);
  });

  it("drops segments timed on a video of another length (an older cut of it), as yt-dlp does", async () => {
    stub.answer({
      status: 200,
      body: [
        entry(VIDEO, [
          // Within a second of the file's 300 s: kept.
          seg([10, 20], "sponsor", "skip", 300.4),
          // Ten seconds off: from another version of the video.
          seg([30, 40], "sponsor", "skip", 310),
          // Two seconds off, under 5 % of a 100 s segment: kept.
          seg([100, 200], "filler", "skip", 302),
          // Two seconds off, but 20 % of a 10 s segment: dropped.
          seg([210, 220], "intro", "skip", 302),
          // SponsorBlock doesn't know the length (0): kept.
          seg([230, 240], "selfpromo", "skip", 0),
        ]),
      ],
    });
    expect(await sponsorBlockClient({ baseUrl: stub.baseUrl }).segments(VIDEO, 300)).toEqual([
      { start: 10, end: 20, category: "sponsor" },
      { start: 100, end: 200, category: "filler" },
      { start: 230, end: 240, category: "selfpromo" },
    ]);
  });

  it("snaps a start within a second of 0 to 0, and an end within a second of the end to it", async () => {
    stub.answer({
      status: 200,
      body: [entry(VIDEO, [seg([0.6, 10], "intro", "skip", 300), seg([295, 299.5], "outro")])],
    });
    expect(await sponsorBlockClient({ baseUrl: stub.baseUrl }).segments(VIDEO, 300)).toEqual([
      { start: 0, end: 10, category: "intro" },
      { start: 295, end: 300, category: "outro" },
    ]);
  });
});
