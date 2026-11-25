import { DEFAULT_SPONSORBLOCK, type SponsorBlockSettings } from "@uroboros/contract";
import { describe, expect, it } from "vitest";
import { skippedSegments, sponsorSegmentsFor } from "./sponsorSegments.ts";

/** As a rendition stores them: sorted by start. */
const stored = [
  { start: 10, end: 20, category: "sponsor" },
  { start: 30, end: 40, category: "intro" },
  { start: 50, end: 55, category: "filler" },
];

const settings = (video: SponsorBlockSettings["video"], audio = DEFAULT_SPONSORBLOCK.audio) => ({
  video,
  audio,
});

describe("a file's SponsorBlock segments, for one person's setting", () => {
  it("keeps a category shown and skipped with both flags", () => {
    expect(
      sponsorSegmentsFor(stored, settings({ show: ["sponsor"], skip: ["sponsor"] }), false),
    ).toEqual([{ start: 10, end: 20, category: "sponsor", show: true, skip: true }]);
  });

  it("keeps a shown-only category with skip false", () => {
    expect(sponsorSegmentsFor(stored, settings({ show: ["intro"], skip: [] }), false)).toEqual([
      { start: 30, end: 40, category: "intro", show: true, skip: false },
    ]);
  });

  it("keeps a skipped-only category with show false", () => {
    expect(sponsorSegmentsFor(stored, settings({ show: [], skip: ["filler"] }), false)).toEqual([
      { start: 50, end: 55, category: "filler", show: false, skip: true },
    ]);
  });

  it("drops a category neither shown nor skipped, and keeps the rest in order", () => {
    const got = sponsorSegmentsFor(
      stored,
      settings({ show: ["sponsor", "intro"], skip: ["sponsor"] }),
      false,
    );
    expect(got.map((s) => s.category)).toEqual(["sponsor", "intro"]);
  });

  it("uses the audio choice for an audio file", () => {
    const s = settings({ show: ["sponsor"], skip: ["sponsor"] }, { show: ["sponsor"], skip: [] });
    expect(sponsorSegmentsFor(stored, s, true)).toEqual([
      { start: 10, end: 20, category: "sponsor", show: true, skip: false },
    ]);
    expect(skippedSegments(stored, s, true)).toEqual([]);
    expect(skippedSegments(stored, s, false)).toEqual([
      { start: 10, end: 20, category: "sponsor" },
    ]);
  });

  it("answers [] for stored JSON it can't read", () => {
    expect(sponsorSegmentsFor("nonsense", DEFAULT_SPONSORBLOCK, false)).toEqual([]);
    expect(sponsorSegmentsFor(null, DEFAULT_SPONSORBLOCK, false)).toEqual([]);
    expect(skippedSegments([{ start: "x" }], DEFAULT_SPONSORBLOCK, false)).toEqual([]);
  });
});
