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
      "--extractor-args=youtube:skip=translated_subs",
      "--sub-langs=de,-.*-orig",
      "--convert-subs=vtt",
    ]);
    expect(subtitleArgs({ langs: null, automatic: true })).toEqual([]);
  });

  it("asks for each automatic caption once: no machine translations of subtitles, no -orig copy", () => {
    // YouTube's "en-orig" is the same file as its "en"; "en-de" is German subtitles machine-translated.
    expect(subtitleArgs({ langs: "en.*", automatic: true })).toEqual(
      expect.arrayContaining([
        "--extractor-args=youtube:skip=translated_subs",
        "--sub-langs=en.*,-.*-orig",
      ]),
    );
    // Unless the setting asks for the originals itself.
    expect(subtitleArgs({ langs: "de-orig,en", automatic: true })).toContain(
      "--sub-langs=de-orig,en",
    );
  });
});
