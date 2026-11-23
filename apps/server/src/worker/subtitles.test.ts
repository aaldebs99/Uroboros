import { describe, expect, it } from "vitest";
import { subtitleArgs } from "./subtitles.ts";

describe("subtitleArgs", () => {
  it("asks for the configured languages as vtt, auto captions only when asked, nothing when off", () => {
    expect(subtitleArgs({ langs: "en.*", automatic: false })).toEqual([
      "--write-subs",
      "--sub-langs=en.*",
      "--convert-subs=vtt",
    ]);
    expect(subtitleArgs({ langs: "de", automatic: true })).toEqual([
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs=de",
      "--convert-subs=vtt",
    ]);
    expect(subtitleArgs({ langs: null, automatic: true })).toEqual([]);
  });
});
