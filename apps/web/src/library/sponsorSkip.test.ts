import { describe, expect, it } from "vitest";

import type { SponsorBlockCategory, SponsorSegment } from "@uroboros/contract";

import { bandTitle, shownSpans, skipSpans, spanReached, timelineCues } from "./sponsorSkip";

/** A segment shown and skipped, as the defaults have the usual categories. */
const both = (start: number, end: number, category: SponsorBlockCategory): SponsorSegment => ({
  start,
  end,
  category,
  show: true,
  skip: true,
});

describe("skipSpans", () => {
  it("joins overlapping and touching segments, keeping their categories", () => {
    expect(
      skipSpans([
        both(913.4, 987.2, "sponsor"),
        both(77.75, 88.45, "sponsor"),
        both(77.69, 88.43, "selfpromo"),
        both(49.04, 69, "sponsor"),
        both(69.3, 72, "interaction"),
      ]),
    ).toEqual([
      { start: 49.04, end: 72, categories: ["sponsor", "interaction"] },
      { start: 77.69, end: 88.45, categories: ["selfpromo", "sponsor"] },
      { start: 913.4, end: 987.2, categories: ["sponsor"] },
    ]);
  });

  it("jumps only over skip segments", () => {
    expect(
      skipSpans([
        { start: 10, end: 20, category: "intro", show: true, skip: false },
        { start: 30, end: 40, category: "filler", show: false, skip: true },
      ]),
    ).toEqual([{ start: 30, end: 40, categories: ["filler"] }]);
  });
});

describe("shownSpans", () => {
  it("bands show segments, one category each so each has its colour, marking the ones playback skips", () => {
    expect(
      shownSpans([
        both(10, 20, "sponsor"),
        { start: 20.2, end: 30, category: "intro", show: true, skip: false },
        { start: 40, end: 50, category: "filler", show: false, skip: true },
        both(20.1, 25, "selfpromo"),
        both(20.3, 22, "sponsor"),
      ]),
    ).toEqual([
      { start: 10, end: 22, category: "sponsor", skipped: true },
      { start: 20.1, end: 25, category: "selfpromo", skipped: true },
      { start: 20.2, end: 30, category: "intro", skipped: false },
    ]);
  });

  it("never joins a band playback jumps with one of the same category it plays through", () => {
    expect(
      shownSpans([
        both(10, 20, "hook"),
        { start: 20, end: 30, category: "hook", show: true, skip: false },
      ]),
    ).toEqual([
      { start: 10, end: 20, category: "hook", skipped: true },
      { start: 20, end: 30, category: "hook", skipped: false },
    ]);
  });
});

describe("timelineCues", () => {
  it("names each band's kind and category in its cue id, for the timeline's markers", () => {
    expect(
      timelineCues(
        [
          both(10, 20, "sponsor"),
          { start: 30, end: 40, category: "intro", show: true, skip: false },
        ],
        null,
      ),
    ).toEqual([
      { id: "skip:sponsor:0", startTime: 10, endTime: 20, text: "Skipped sponsor" },
      { id: "show:intro:1", startTime: 30, endTime: 40, text: "Intro" },
    ]);
  });

  it("marks the highlight as a second-long point", () => {
    expect(timelineCues([], 42.5)).toEqual([
      { id: "point:poi_highlight:0", startTime: 42.5, endTime: 43.5, text: "Highlight" },
    ]);
  });
});

describe("spanReached", () => {
  const spans = skipSpans([both(49.04, 69, "sponsor")]);

  it("finds the span playback ran into, short of its last moment", () => {
    expect(spanReached(spans, 48.9, 49.15)?.end).toBe(69);
    expect(spanReached(spans, 48.9, 49.04)?.end).toBe(69);
    expect(spanReached(spans, 48.5, 48.9)).toBeUndefined();
  });

  it("leaves a span playback is already inside to play out (a seek put it there)", () => {
    expect(spanReached(spans, 55, 55.25)).toBeUndefined();
    expect(spanReached(spans, 49.04, 49.3)).toBeUndefined();
  });

  it("takes a jump over 2 s, or one backwards, for a seek", () => {
    expect(spanReached(spans, 40, 50)).toBeUndefined();
    expect(spanReached(spans, 70, 50)).toBeUndefined();
  });

  it("leaves the last moment of a short reach alone", () => {
    const short = skipSpans([both(10, 10.3, "interaction")]);
    expect(spanReached(short, 9.9, 10.15)).toBeUndefined();
  });

  it("reaches a span that starts the video from just before 0", () => {
    const intro = skipSpans([both(0, 8, "intro")]);
    expect(spanReached(intro, -0.001, 0.25)?.end).toBe(8);
  });
});

describe("bandTitle", () => {
  it("names what a skipped band skips, and what a shown one is", () => {
    const band = (category: SponsorBlockCategory, skipped: boolean) => ({
      start: 0,
      end: 1,
      category,
      skipped,
    });
    expect(bandTitle(band("sponsor", true))).toBe("Skipped sponsor");
    expect(bandTitle(band("music_offtopic", true))).toBe("Skipped non-music section");
    expect(bandTitle(band("sponsor", false))).toBe("Sponsor");
    expect(bandTitle(band("hook", false))).toBe("Hook or greeting");
  });
});
