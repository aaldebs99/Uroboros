import { describe, expect, it } from "vitest";
import { cutSeconds, keptRanges, mapTime, mergeCuts, remapChapters } from "./cuts.ts";

/** The GTA VI video's segments (1008 s): self-promotion and sponsor overlap at 77.7–88.45. */
const GTA = [
  { start: 913.435, end: 987.182, category: "sponsor" as const },
  { start: 77.75, end: 88.45, category: "sponsor" as const },
  { start: 49.04, end: 69, category: "sponsor" as const },
  { start: 77.694, end: 88.43, category: "selfpromo" as const },
];

describe("mergeCuts", () => {
  it("joins overlapping segments and orders them", () => {
    expect(mergeCuts(GTA, 1008)).toEqual([
      { start: 49.04, end: 69 },
      { start: 77.694, end: 88.45 },
      { start: 913.435, end: 987.182 },
    ]);
  });

  it("joins segments under half a second apart, and clips them to the file", () => {
    expect(
      mergeCuts(
        [
          { start: 10, end: 20, category: "sponsor" },
          { start: 20.3, end: 25, category: "interaction" },
          { start: 590, end: 700, category: "outro" },
        ],
        600,
      ),
    ).toEqual([
      { start: 10, end: 25 },
      { start: 590, end: 600 },
    ]);
  });

  it("takes a sliver at either end with the cut beside it", () => {
    expect(
      mergeCuts(
        [
          { start: 0.1, end: 5, category: "intro" },
          { start: 50, end: 59.9, category: "outro" },
        ],
        60,
      ),
    ).toEqual([
      { start: 0, end: 5 },
      { start: 50, end: 60 },
    ]);
  });
});

describe("keptRanges and cutSeconds", () => {
  it("keeps the file between the cuts, the last range to its end", () => {
    const cuts = mergeCuts(GTA, 1008);
    expect(keptRanges(cuts)).toEqual([
      { start: 0, end: 49.04 },
      { start: 69, end: 77.694 },
      { start: 88.45, end: 913.435 },
      { start: 987.182, end: null },
    ]);
    expect(cutSeconds(cuts)).toBe(104.463);
  });

  it("starts after a cut at the start", () => {
    expect(keptRanges([{ start: 0, end: 5 }])).toEqual([{ start: 5, end: null }]);
  });
});

describe("chapters on the copy", () => {
  const cuts = mergeCuts(GTA, 1008);

  it("moves times as the cuts close up; a time inside a cut goes to where the cut was", () => {
    expect(mapTime(cuts, 30)).toBe(30);
    expect(mapTime(cuts, 60)).toBe(49.04);
    expect(mapTime(cuts, 89)).toBe(58.284);
    expect(mapTime(cuts, 1008)).toBe(903.537);
  });

  it("moves each chapter, and drops one the cuts swallow", () => {
    expect(
      remapChapters(
        [
          { start: 0, end: 89, title: "Intro" },
          { start: 89, end: 333, title: "DLSS 5 and FrameGen ON" },
          { start: 913.5, end: 987, title: "Ad read" },
          { start: 987, end: null, title: null },
        ],
        cuts,
        1008,
      ),
    ).toEqual([
      { start: 0, end: 58.284, title: "Intro" },
      { start: 58.284, end: 882.719, title: "DLSS 5 and FrameGen ON" },
      { start: 882.719, end: 903.537, title: "Chapter 4" },
    ]);
  });
});
