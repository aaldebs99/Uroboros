import { describe, expect, it } from "vitest";

import type { SponsorBlockCategory, SponsorSegment } from "@uroboros/contract";

import { bandTitle, shownSpans, skipSpans, spanReached } from "./sponsorSkip";

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
  it("bands show segments, marking the ones playback skips, never joining the two kinds", () => {
    expect(
      shownSpans([
        both(10, 20, "sponsor"),
        { start: 20.2, end: 30, category: "intro", show: true, skip: false },
        { start: 40, end: 50, category: "filler", show: false, skip: true },
        both(20.1, 25, "selfpromo"),
      ]),
    ).toEqual([
      { start: 10, end: 25, categories: ["sponsor", "selfpromo"], skipped: true },
      { start: 20.2, end: 30, categories: ["intro"], skipped: false },
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
    const band = (categories: SponsorBlockCategory[], skipped: boolean) => ({
      start: 0,
      end: 1,
      categories,
      skipped,
    });
    expect(bandTitle(band(["sponsor"], true))).toBe("Skipped sponsor");
    expect(bandTitle(band(["selfpromo", "sponsor"], true))).toBe(
      "Skipped self-promotion and sponsor",
    );
    expect(bandTitle(band(["sponsor", "intro", "music_offtopic"], true))).toBe(
      "Skipped sponsor, intro and non-music section",
    );
    expect(bandTitle(band(["sponsor"], false))).toBe("Sponsor");
    expect(bandTitle(band(["intro", "outro"], false))).toBe("Intro and outro");
  });
});
