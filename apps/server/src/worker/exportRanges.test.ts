import { describe, expect, it } from "vitest";
import { rangesOf } from "./exportRanges.ts";

const info = { duration: 100, startTime: 0.5 };

describe("rangesOf", () => {
  it("keeps what lies between a copy's cuts, on the file's own clock (its start time added)", () => {
    const cuts = [
      { start: 10, end: 25 },
      { start: 80, end: 90 },
    ];
    expect(rangesOf({ cuts, clip: null }, info, true)).toEqual({
      ranges: [
        { start: 0.5, end: 10.5 },
        { start: 25.5, end: 80.5 },
        { start: 90.5, end: null },
      ],
      seek: null,
      kept: 75,
      chapterCuts: cuts,
    });
  });

  it("seeks a video clip to its start and keeps its length from there", () => {
    const clip = { start: 62, end: 90 };
    expect(rangesOf({ cuts: [], clip }, info, true)).toEqual({
      ranges: [{ start: 0, end: 28 }],
      seek: 62,
      kept: 28,
      chapterCuts: [
        { start: 0, end: 62 },
        { start: 90, end: 100 },
      ],
    });
  });

  it("trims an audio clip from the start, with no seek (a VBR MP3's would land off)", () => {
    const clip = { start: 62, end: 90 };
    expect(rangesOf({ cuts: [], clip }, info, false)).toMatchObject({
      ranges: [{ start: 62.5, end: 90.5 }],
      seek: null,
      kept: 28,
    });
  });

  it("knows no kept length of a copy without sponsors when the file's length is unknown", () => {
    expect(
      rangesOf(
        { cuts: [{ start: 0, end: 5 }], clip: null },
        { duration: null, startTime: null },
        true,
      ).kept,
    ).toBeNull();
  });
});
