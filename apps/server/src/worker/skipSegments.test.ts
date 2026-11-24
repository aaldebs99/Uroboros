import type { SponsorSegment } from "@uroboros/ytdlp";
import { describe, expect, it } from "vitest";
import type { ProfileArgs } from "../downloads/profiles.ts";
import { skipSegmentsFor } from "./skipSegments.ts";

const video: ProfileArgs = {
  format: "bv*+ba/b",
  mergeFormat: null,
  audioOnly: false,
  audioFormat: null,
  extraArgs: [],
  sponsorblockRemove: ["interaction", "selfpromo", "sponsor"],
};

const seg = (startTime: number, endTime: number, category: string, type: string | null = "skip") =>
  ({ startTime, endTime, category, type }) satisfies SponsorSegment;

describe("skipSegmentsFor", () => {
  it("keeps a video's marked segments of the profile's categories, in order", () => {
    expect(
      skipSegmentsFor(video, [
        seg(913.435, 987.182, "sponsor"),
        seg(77.75, 88.45, "sponsor"),
        seg(49.04, 69, "sponsor"),
        seg(77.694, 88.43, "selfpromo"),
        seg(0, 10, "intro"),
        seg(120, 120, "poi_highlight", "poi"),
        seg(200, 300, "sponsor", "chapter"),
        seg(400, 390, "sponsor"),
        seg(500, 510, "exclusive_access", "full"),
        seg(600, 610, "interaction", null),
      ]),
    ).toEqual([
      { start: 49.04, end: 69, category: "sponsor" },
      { start: 77.694, end: 88.43, category: "selfpromo" },
      { start: 77.75, end: 88.45, category: "sponsor" },
      { start: 600, end: 610, category: "interaction" },
      { start: 913.435, end: 987.182, category: "sponsor" },
    ]);
  });

  it("gives an audio file none: its segments were cut out", () => {
    const audio = { ...video, audioOnly: true, audioFormat: "mp3" };
    expect(skipSegmentsFor(audio, [seg(49.04, 69, "sponsor")])).toEqual([]);
  });

  it("gives a profile without categories none", () => {
    const { sponsorblockRemove: _, ...none } = video;
    expect(skipSegmentsFor(none, [seg(49.04, 69, "sponsor")])).toEqual([]);
    expect(skipSegmentsFor({ ...video, sponsorblockRemove: [] }, [seg(1, 2, "sponsor")])).toEqual(
      [],
    );
  });
});
