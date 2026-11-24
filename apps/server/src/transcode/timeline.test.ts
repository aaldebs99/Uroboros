import { describe, expect, it } from "vitest";
import { keyframeBoundaries, SEGMENT_SECONDS, segmentAt, uniformBoundaries } from "./timeline.ts";

describe("uniformBoundaries", () => {
  it("cuts every 6 s from 0 and ends at the duration", () => {
    expect(SEGMENT_SECONDS).toBe(6);
    expect(uniformBoundaries(20)).toEqual([0, 6, 12, 18, 20]);
    expect(uniformBoundaries(18)).toEqual([0, 6, 12, 18]);
  });

  it("folds a sliver of a last segment into the one before", () => {
    expect(uniformBoundaries(18.2)).toEqual([0, 6, 12, 18.2]);
    expect(uniformBoundaries(3)).toEqual([0, 3]);
  });
});

describe("keyframeBoundaries", () => {
  it("cuts at the first keyframe at or after each 6 s mark", () => {
    const keyframes = [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30];
    expect(keyframeBoundaries(keyframes, 31)).toEqual([0, 7.5, 12.5, 20, 25, 30, 31]);
  });

  it("keeps a long GOP as one long segment", () => {
    expect(keyframeBoundaries([0, 10, 11, 25], 30)).toEqual([0, 10, 25, 30]);
  });

  it("always starts at 0 and ignores keyframes past the end", () => {
    expect(keyframeBoundaries([0.04, 6.04, 12.04, 40], 13)).toEqual([0, 6.04, 13]);
    expect(keyframeBoundaries([], 9)).toEqual([0, 9]);
  });

  it("takes a keyframe a hair before the mark as on it", () => {
    expect(keyframeBoundaries([0, 5.9995, 11.9999], 15)).toEqual([0, 5.9995, 11.9999, 15]);
  });
});

describe("segmentAt", () => {
  const b = [0, 6, 12, 15];
  it("finds the segment holding a time, clamped to the ends", () => {
    expect(segmentAt(b, 0)).toBe(0);
    expect(segmentAt(b, 5.99)).toBe(0);
    expect(segmentAt(b, 6)).toBe(1);
    expect(segmentAt(b, 14.9)).toBe(2);
    expect(segmentAt(b, 99)).toBe(2);
    expect(segmentAt(b, -1)).toBe(0);
  });
});
