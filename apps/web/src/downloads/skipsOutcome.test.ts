import { describe, expect, it } from "vitest";

import { skipsOutcome } from "./skipsOutcome";

const found = (n: number | null, more: { total?: number | null; highlight?: boolean } = {}) => ({
  found: n,
  error: null,
  total: more.total ?? n,
  highlight: more.highlight ?? false,
});

describe("skipsOutcome", () => {
  it("says how many segments the person's setting shows or skips now, and the highlight", () => {
    expect(skipsOutcome(found(1))).toEqual({
      tone: "success",
      title: "Found 1 SponsorBlock segment",
    });
    expect(skipsOutcome(found(3, { total: 5 }))).toEqual({
      tone: "success",
      title: "Found 3 SponsorBlock segments",
    });
    expect(skipsOutcome(found(2, { highlight: true }))).toEqual({
      tone: "success",
      title: "Found 2 SponsorBlock segments and the highlight",
    });
  });

  it("says when SponsorBlock has no segments for the video, with or without a highlight", () => {
    expect(skipsOutcome(found(0))).toEqual({
      tone: "info",
      title: "SponsorBlock has no segments for this video yet",
    });
    expect(skipsOutcome(found(0, { total: null }))).toEqual({
      tone: "info",
      title: "SponsorBlock has no segments for this video yet",
    });
    expect(skipsOutcome(found(0, { highlight: true }))).toEqual({
      tone: "success",
      title: "Found the highlight; SponsorBlock has no segments for this video yet",
    });
  });

  it("says when the video's segments are all in categories the person neither shows nor skips", () => {
    expect(skipsOutcome(found(0, { total: 2 }))).toEqual({
      tone: "info",
      title: "None of this video's 2 SponsorBlock segments are in categories you show or skip",
      detail: "Settings › SponsorBlock chooses which ones show and skip.",
    });
    expect(skipsOutcome(found(0, { total: 1, highlight: true }))).toEqual({
      tone: "info",
      title: "This video's 1 SponsorBlock segment isn't in a category you show or skip",
      detail: "Found the highlight. Settings › SponsorBlock chooses which ones show and skip.",
    });
  });

  it("says why it failed", () => {
    expect(
      skipsOutcome({
        found: null,
        error: "the site is limiting requests",
        total: null,
        highlight: false,
      }),
    ).toEqual({
      tone: "error",
      title: "Could not fetch SponsorBlock segments",
      detail: "the site is limiting requests",
    });
  });
});
