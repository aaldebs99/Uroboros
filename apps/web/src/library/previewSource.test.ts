import { describe, expect, it } from "vitest";

import { itemFixture } from "@/test/libraryItem";

import { pickPreviewSubtitle, previewSources } from "./previewSource";

const STORED = "/api/library/e1/preview?v=1";
const sub = (lang: string, automatic = false) => ({ lang, automatic });

describe("previewSources", () => {
  it("plays the stored preview first, then the original, then a live copy", () => {
    expect(previewSources({ ...itemFixture, previewUrl: STORED }, true)).toEqual([
      { kind: "file", url: STORED },
      { kind: "file", url: itemFixture.streamUrl },
      { kind: "session" },
    ]);
  });

  it("goes live straight away when there is no stored preview and the original won't play", () => {
    expect(previewSources({ ...itemFixture, previewUrl: null }, false)).toEqual([
      { kind: "session" },
    ]);
    expect(previewSources({ ...itemFixture, previewUrl: STORED }, false)).toEqual([
      { kind: "file", url: STORED },
      { kind: "session" },
    ]);
  });
});

describe("pickPreviewSubtitle", () => {
  it("shows the remembered language, as the player would", () => {
    expect(pickPreviewSubtitle([sub("en"), sub("fr")], "fr")).toBe(1);
  });

  it("shows the first manual track when nothing is remembered, else the first track", () => {
    expect(pickPreviewSubtitle([sub("de", true), sub("en")], null)).toBe(1);
    expect(pickPreviewSubtitle([sub("de", true), sub("en", true)], null)).toBe(0);
  });

  it("shows nothing for a video without subtitles", () => {
    expect(pickPreviewSubtitle([], "en")).toBeNull();
    expect(pickPreviewSubtitle([], null)).toBeNull();
  });
});
