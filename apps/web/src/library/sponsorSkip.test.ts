import { describe, expect, it } from "vitest";

import { skippedTitle, skipSpans, spanReached } from "./sponsorSkip";

describe("skipSpans", () => {
  it("joins overlapping and touching segments, keeping their categories", () => {
    expect(
      skipSpans([
        { start: 913.4, end: 987.2, category: "sponsor" },
        { start: 77.75, end: 88.45, category: "sponsor" },
        { start: 77.69, end: 88.43, category: "selfpromo" },
        { start: 49.04, end: 69, category: "sponsor" },
        { start: 69.3, end: 72, category: "interaction" },
      ]),
    ).toEqual([
      { start: 49.04, end: 72, categories: ["sponsor", "interaction"] },
      { start: 77.69, end: 88.45, categories: ["selfpromo", "sponsor"] },
      { start: 913.4, end: 987.2, categories: ["sponsor"] },
    ]);
  });
});

describe("spanReached", () => {
  const spans = skipSpans([{ start: 49.04, end: 69, category: "sponsor" }]);
  const none = new Set<number>();

  it("finds the span playback ran into, short of its last moment", () => {
    expect(spanReached(spans, 48.9, 49.15, none)?.end).toBe(69);
    expect(spanReached(spans, 48.9, 49.04, none)?.end).toBe(69);
    expect(spanReached(spans, 48.5, 48.9, none)).toBeUndefined();
  });

  it("leaves a span playback is already inside to play out (a seek put it there)", () => {
    expect(spanReached(spans, 55, 55.25, none)).toBeUndefined();
    expect(spanReached(spans, 49.04, 49.3, none)).toBeUndefined();
  });

  it("takes a jump over 2 s, or one backwards, for a seek", () => {
    expect(spanReached(spans, 40, 50, none)).toBeUndefined();
    expect(spanReached(spans, 70, 50, none)).toBeUndefined();
  });

  it("leaves the last moment of a short reach, and a span the viewer undid, alone", () => {
    const short = skipSpans([{ start: 10, end: 10.3, category: "interaction" }]);
    expect(spanReached(short, 9.9, 10.15, none)).toBeUndefined();
    expect(spanReached(spans, 48.9, 49.15, new Set([49.04]))).toBeUndefined();
  });

  it("reaches a span that starts the video from just before 0", () => {
    const intro = skipSpans([{ start: 0, end: 8, category: "intro" }]);
    expect(spanReached(intro, -0.001, 0.25, none)?.end).toBe(8);
  });
});

describe("skippedTitle", () => {
  it("names what was skipped", () => {
    expect(skippedTitle({ start: 0, end: 1, categories: ["sponsor"] })).toBe("Skipped sponsor");
    expect(skippedTitle({ start: 0, end: 1, categories: ["selfpromo", "sponsor"] })).toBe(
      "Skipped self-promotion and sponsor",
    );
    expect(
      skippedTitle({ start: 0, end: 1, categories: ["sponsor", "intro", "music_offtopic"] }),
    ).toBe("Skipped sponsor, intro and non-music section");
  });
});
