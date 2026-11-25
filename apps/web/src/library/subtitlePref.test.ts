import { describe, expect, it } from "vitest";

import { pickSubtitle, showingLanguage } from "./subtitlePref";

const manual = (lang: string) => ({ lang, automatic: false });
const auto = (lang: string) => ({ lang, automatic: true });

describe("pickSubtitle", () => {
  it("shows nothing when subtitles are off, or the video has none", () => {
    expect(pickSubtitle([manual("en")], null)).toBeNull();
    expect(pickSubtitle([], "en")).toBeNull();
  });

  it("prefers a manual track in the saved language over an automatic one", () => {
    expect(pickSubtitle([auto("fr"), manual("fr")], "fr")).toBe(1);
  });

  it("takes an automatic track when it is the only one in the saved language", () => {
    expect(pickSubtitle([manual("en"), auto("fr")], "fr")).toBe(1);
  });

  it("takes an exact match before a regional one", () => {
    expect(pickSubtitle([manual("en-GB"), auto("en")], "en")).toBe(1);
  });

  it("matches the base language either way, in any case", () => {
    expect(pickSubtitle([manual("de"), manual("en")], "en-US")).toBe(1);
    expect(pickSubtitle([manual("de"), manual("en-GB")], "en")).toBe(1);
    expect(pickSubtitle([manual("de"), auto("EN-orig")], "en")).toBe(1);
  });

  it("falls back to the first manual track, else the first track", () => {
    expect(pickSubtitle([auto("de"), manual("en")], "fr")).toBe(1);
    expect(pickSubtitle([auto("de"), auto("en")], "fr")).toBe(0);
  });
});

describe("showingLanguage", () => {
  const track = (kind: TextTrackKind, language: string, mode: TextTrackMode) =>
    ({ kind, language, mode }) as TextTrack;

  it("names the subtitles or captions track showing, and nothing else", () => {
    expect(
      showingLanguage([track("chapters", "en", "showing"), track("subtitles", "fr", "disabled")]),
    ).toBeNull();
    expect(
      showingLanguage([track("metadata", "en", "hidden"), track("captions", "fr", "showing")]),
    ).toBe("fr");
    expect(showingLanguage([track("subtitles", "de", "showing")])).toBe("de");
  });
});
