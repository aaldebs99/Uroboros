import { describe, expect, it } from "vitest";

import { skipsOutcome } from "./skipsOutcome";

describe("skipsOutcome", () => {
  it("says how many segments the person's setting shows or skips now", () => {
    expect(skipsOutcome({ found: 1, error: null })).toEqual({
      tone: "success",
      title: "Found 1 SponsorBlock segment",
    });
    expect(skipsOutcome({ found: 3, error: null })).toEqual({
      tone: "success",
      title: "Found 3 SponsorBlock segments",
    });
  });

  it("says when there are none of the kinds they show or skip yet", () => {
    expect(skipsOutcome({ found: 0, error: null })).toEqual({
      tone: "info",
      title: "No SponsorBlock segments you show or skip, yet",
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
