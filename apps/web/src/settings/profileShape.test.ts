import type { FormatProfile } from "@uroboros/contract";
import { describe, expect, it } from "vitest";

import {
  QUALITIES,
  audioSelectorFor,
  describeProfile,
  isStandardAudioSelector,
  qualityOf,
  selectorFor,
} from "./profileShape";

/** A profile's plain choices, and the yt-dlp format selectors they stand for. */

const profile = (over: Partial<FormatProfile>): FormatProfile => ({
  id: "0190a3f2-7c1e-7000-8000-000000000001",
  name: "p",
  format: "bv*+ba/b",
  mergeFormat: null,
  videoCodec: null,
  audioOnly: false,
  audioFormat: null,
  extraArgs: [],
  builtIn: false,
  isDefault: false,
  revision: "r",
  ...over,
});

describe("quality", () => {
  it("writes the selectors the built-ins use, capped at a height or not", () => {
    expect(selectorFor("best")).toBe("bv*+ba/b");
    expect(selectorFor("1080")).toBe("bv*[height<=1080]+ba/b[height<=1080]");
    expect(selectorFor("720")).toBe("bv*[height<=720]+ba/b[height<=720]");
  });

  it("reads each quality back from its selector, and nothing else", () => {
    for (const q of QUALITIES) expect(qualityOf(selectorFor(q.value))).toBe(q.value);
    expect(qualityOf("  bv*+ba/b ")).toBe("best");
    expect(qualityOf("bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b")).toBeNull();
    expect(qualityOf("b")).toBeNull();
  });
});

describe("audio", () => {
  it("takes M4A as it comes when there is one, else the best audio, converted", () => {
    expect(audioSelectorFor("m4a")).toBe("ba[ext=m4a]/ba/b");
    expect(audioSelectorFor("mp3")).toBe("ba/b");
    expect(audioSelectorFor("opus")).toBe("ba/b");
  });

  it("knows the selector its format writes from any other, hand-written or another format's", () => {
    expect(isStandardAudioSelector("ba/b", "mp3")).toBe(true);
    expect(isStandardAudioSelector(" ba[ext=m4a]/ba/b ", "m4a")).toBe(true);
    expect(isStandardAudioSelector("ba/b", "m4a")).toBe(false);
    expect(isStandardAudioSelector("ba[ext=m4a]/ba/b", "opus")).toBe(false);
    expect(isStandardAudioSelector("ba[abr>128]/ba", "opus")).toBe(false);
  });
});

describe("describeProfile", () => {
  it("says a video profile's quality, codec and container in words", () => {
    expect(
      describeProfile(
        profile({
          format: "bv*[height<=1080]+ba/b[height<=1080]",
          videoCodec: "av1",
          mergeFormat: "mp4",
        }),
      ),
    ).toBe("Up to 1080p · AV1 · MP4");
    expect(describeProfile(profile({}))).toBe("Best available · any codec · any container");
  });

  it("shows a hand-written selector, an unlisted container and the extra arguments as they are", () => {
    expect(
      describeProfile(
        profile({ format: "b[height<=720]", mergeFormat: "mov", extraArgs: ["--embed-chapters"] }),
      ),
    ).toBe("b[height<=720] · any codec · mov · --embed-chapters");
  });

  it("says an audio profile's format", () => {
    expect(
      describeProfile(
        profile({
          format: "ba/b",
          audioOnly: true,
          audioFormat: "mp3",
          extraArgs: ["--audio-quality=0"],
        }),
      ),
    ).toBe("Audio · MP3 · --audio-quality=0");
    expect(
      describeProfile(profile({ format: "ba[abr>100]", audioOnly: true, audioFormat: "opus" })),
    ).toBe("Audio · Opus · ba[abr>100]");
    expect(describeProfile(profile({ format: "ba/b", audioOnly: true, audioFormat: "m4a" }))).toBe(
      "Audio · M4A (AAC) · ba/b",
    );
  });
});
