import { describe, expect, it } from "vitest";

import {
  clipLabel,
  defaultRange,
  keyDelta,
  moveEnd,
  moveStart,
  percent,
  rangeOf,
  rangeQuery,
} from "./clipRange";

describe("defaultRange", () => {
  it("picks 30 s from the playhead", () => {
    expect(defaultRange(100, 600)).toEqual({ start: 100, end: 130 });
  });

  it("shifts back near the end, and takes a video shorter than that whole", () => {
    expect(defaultRange(590, 600)).toEqual({ start: 570, end: 600 });
    expect(defaultRange(5, 20)).toEqual({ start: 0, end: 20 });
  });
});

describe("moving a handle", () => {
  const r = { start: 10, end: 40 };

  it("keeps the start between 0 and a second before the end", () => {
    expect(moveStart(r, 20, 100)).toEqual({ start: 20, end: 40 });
    expect(moveStart(r, -5, 100)).toEqual({ start: 0, end: 40 });
    expect(moveStart(r, 45, 100)).toEqual({ start: 39, end: 40 });
  });

  it("keeps the end between a second after the start and the end of the video", () => {
    expect(moveEnd(r, 60, 100)).toEqual({ start: 10, end: 60 });
    expect(moveEnd(r, 200, 100)).toEqual({ start: 10, end: 100 });
    expect(moveEnd(r, 5, 100)).toEqual({ start: 10, end: 11 });
  });
});

describe("keyDelta", () => {
  it("steps a second with the arrows, ten with Shift or a page key, and to the ends with Home and End", () => {
    expect(keyDelta("ArrowRight", false)).toBe(1);
    expect(keyDelta("ArrowLeft", false)).toBe(-1);
    expect(keyDelta("ArrowUp", true)).toBe(10);
    expect(keyDelta("PageDown", false)).toBe(-10);
    expect(keyDelta("Home", false)).toBe(Number.NEGATIVE_INFINITY);
    expect(keyDelta("End", false)).toBe(Number.POSITIVE_INFINITY);
    expect(keyDelta("a", false)).toBeNull();
  });
});

describe("a range's words and address", () => {
  it("says a range as the player shows times", () => {
    expect(clipLabel({ start: 62, end: 90.4 })).toBe("1:02–1:30");
  });

  it("puts a range in a link and reads it back", () => {
    expect(rangeQuery({ start: 62.34, end: 90.46 })).toBe("t=62.3&end=90.5");
    expect(rangeOf({ t: "62.3", end: "90.5" })).toEqual({ start: 62.3, end: 90.5 });
    expect(rangeOf({ t: 62, end: 90 })).toEqual({ start: 62, end: 90 });
  });

  it("reads no range from a link without both ends, or one shorter than a second", () => {
    expect(rangeOf({ t: "62" })).toBeNull();
    expect(rangeOf({ end: "90" })).toBeNull();
    expect(rangeOf({ t: "62", end: "62.5" })).toBeNull();
    expect(rangeOf({ t: "x", end: "90" })).toBeNull();
  });

  it("places a time along the timeline, as a percentage", () => {
    expect(percent(25, 100)).toBe(25);
    expect(percent(150, 100)).toBe(100);
    expect(percent(10, 0)).toBe(0);
  });
});
