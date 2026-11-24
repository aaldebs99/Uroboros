import { describe, expect, it } from "vitest";
import { PlaybackRequest, PlaybackSession, QUALITY_RUNGS, Quality } from "./playback.ts";

describe("playback sessions", () => {
  it("names Original and the six rungs", () => {
    // A zod enum is an object underneath: its integer-like keys come out sorted, so compare sets.
    expect(new Set(Quality.options)).toEqual(
      new Set(["original", "2160", "1440", "1080", "720", "480", "360"]),
    );
    expect(QUALITY_RUNGS).toEqual(["2160", "1440", "1080", "720", "480", "360"]);
  });

  it("asks for a quality from a position, saying which codecs the browser plays", () => {
    expect(
      PlaybackRequest.parse({ quality: "720", start: 12.5, copyVideo: false, copyAudio: true }),
    ).toEqual({ quality: "720", start: 12.5, copyVideo: false, copyAudio: true });
    expect(
      PlaybackRequest.safeParse({ quality: "4k", start: 0, copyVideo: true, copyAudio: true })
        .success,
    ).toBe(false);
    expect(
      PlaybackRequest.safeParse({ quality: "720", start: -1, copyVideo: true, copyAudio: true })
        .success,
    ).toBe(false);
  });

  it("describes a session: its state, how it plays, and where", () => {
    const s = {
      id: "6f1c1b0e-2a4b-4c5d-8e9f-0a1b2c3d4e5f",
      state: "running",
      mode: "encode",
      quality: "720",
      encoder: "nvenc",
      width: 1280,
      height: 720,
      reason: "picked",
      url: "/api/library/e/playback/sessions/6f1c1b0e-2a4b-4c5d-8e9f-0a1b2c3d4e5f",
      masterUrl:
        "/api/library/e/playback/sessions/6f1c1b0e-2a4b-4c5d-8e9f-0a1b2c3d4e5f/master.m3u8",
      error: null,
    };
    expect(PlaybackSession.parse(s)).toEqual(s);
    expect(PlaybackSession.safeParse({ ...s, encoder: "qsv" }).success).toBe(false);
  });
});
