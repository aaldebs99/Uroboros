import { describe, expect, it } from "vitest";

import { skippedTitle, skipSpans, spanAt } from "./sponsorSkip";

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

describe("spanAt", () => {
  const spans = skipSpans([{ start: 49.04, end: 69, category: "sponsor" }]);

  it("finds the span playback is inside, short of its last moment", () => {
    expect(spanAt(spans, 49.04, new Set())?.end).toBe(69);
    expect(spanAt(spans, 60, new Set())?.end).toBe(69);
    expect(spanAt(spans, 68.85, new Set())).toBeUndefined();
    expect(spanAt(spans, 48.9, new Set())).toBeUndefined();
    expect(spanAt(spans, 69, new Set())).toBeUndefined();
  });

  it("leaves a span the viewer undid alone", () => {
    expect(spanAt(spans, 60, new Set([49.04]))).toBeUndefined();
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
