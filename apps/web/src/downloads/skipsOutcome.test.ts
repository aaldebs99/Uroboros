import { describe, expect, it } from "vitest";

import { skipsOutcome } from "./skipsOutcome";

describe("skipsOutcome", () => {
  it("says how many segments the player now skips", () => {
    expect(skipsOutcome({ found: 1, error: null })).toEqual({
      tone: "success",
      title: "Found 1 SponsorBlock segment to skip",
    });
    expect(skipsOutcome({ found: 3, error: null })).toEqual({
      tone: "success",
      title: "Found 3 SponsorBlock segments to skip",
    });
  });

  it("says when SponsorBlock has none yet", () => {
    expect(skipsOutcome({ found: 0, error: null })).toEqual({
      tone: "info",
      title: "SponsorBlock has no segments for this video yet",
    });
  });

  it("says why it failed", () => {
    expect(skipsOutcome({ found: null, error: "the site is limiting requests" })).toEqual({
      tone: "error",
      title: "Could not fetch SponsorBlock segments",
      detail: "the site is limiting requests",
    });
  });
});
