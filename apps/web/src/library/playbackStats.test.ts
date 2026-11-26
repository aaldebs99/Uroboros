import type { PlaybackSession } from "@uroboros/contract";
import { describe, expect, it } from "vitest";

import {
  bitrateText,
  bufferAhead,
  framesLine,
  lastSegment,
  networkLine,
  outputLine,
  sourceLine,
  statusText,
  viewportLine,
} from "./playbackStats";

/** The words of the player's Stats panel (docs/transcoding.md). */

const url = "/api/library/e/playback/sessions/s";
const session = (over: Partial<PlaybackSession>): PlaybackSession => ({
  id: "0190a3f2-7c1e-7000-8000-000000000001",
  state: "running",
  mode: "encode",
  quality: "720",
  encoder: "nvenc",
  width: 1280,
  height: 720,
  bitrate: 4_000_000,
  reason: "picked",
  url,
  masterUrl: `${url}/master.m3u8`,
  error: null,
  ...over,
});

/** TimeRanges from [start, end] pairs. */
const ranges = (...r: [number, number][]) => ({
  length: r.length,
  start: (i: number) => (r[i] as [number, number])[0],
  end: (i: number) => (r[i] as [number, number])[1],
});

describe("statusText", () => {
  it("says how the video plays: as it is, copied, or transcoded, on what and why", () => {
    expect(statusText(null, "h264")).toBe("Direct play");
    expect(
      statusText(session({ mode: "remux", reason: "container", encoder: "copy" }), "vp9"),
    ).toBe("Direct stream");
    expect(statusText(session({}), "h264")).toBe("Transcoding to 720p · NVIDIA GPU");
    expect(
      statusText(
        session({
          quality: "original",
          encoder: "libx264",
          width: 3840,
          height: 2160,
          reason: "video_unsupported",
        }),
        "av1",
      ),
    ).toBe("Transcoding to 2160p · CPU · this browser can't play AV1");
    expect(statusText(session({ mode: "audio", reason: "audio_unsupported" }), null)).toBe(
      "Converting the audio",
    );
  });
});

describe("the panel's lines", () => {
  it("says the source's codecs, container, size and bitrate", () => {
    expect(
      sourceLine({
        videoCodecs: "av01.0.13M.08",
        audioCodecs: "mp4a.40.2",
        container: "mp4",
        width: 3840,
        height: 2160,
        sizeBytes: 1_530_000_000,
        duration: 1788,
      }),
    ).toBe("AV1 · AAC · MP4 · 3840×2160 · 6.85 Mb/s");
    expect(
      sourceLine({
        videoCodecs: "vp09.00.40.08",
        audioCodecs: "opus",
        container: "webm",
        width: 1920,
        height: 1080,
        duration: null,
      }),
    ).toBe("VP9 · Opus · WebM · 1920×1080");
  });

  it("says what a session sends: an encode's size and target, or the video copied", () => {
    expect(outputLine(null)).toBeNull();
    expect(outputLine(session({ bitrate: 13_680_000, width: 3840, height: 2160 }))).toBe(
      "H.264 · 3840×2160 · 13.7 Mb/s target",
    );
    expect(outputLine(session({ mode: "remux", bitrate: null }))).toBe("Video copied · 1280×720");
    expect(outputLine(session({ mode: "audio", width: null, height: null, bitrate: null }))).toBe(
      "Audio only",
    );
  });

  it("writes bitrates in Mb/s, and under one in kb/s", () => {
    expect(bitrateText(13_680_000)).toBe("13.7 Mb/s");
    expect(bitrateText(6_846_000)).toBe("6.85 Mb/s");
    expect(bitrateText(500_000)).toBe("500 kb/s");
  });

  it("says the player's size on screen and the picture it decodes", () => {
    expect(
      viewportLine({ width: 1280, height: 720, ratio: 2, videoWidth: 3840, videoHeight: 2160 }),
    ).toBe("1280×720 ×2 · decoding 3840×2160");
    expect(viewportLine({ width: 800, height: 450, ratio: 1, videoWidth: 0, videoHeight: 0 })).toBe(
      "800×450 ×1",
    );
  });

  it("counts dropped frames, when the browser says", () => {
    expect(framesLine({ droppedVideoFrames: 3, totalVideoFrames: 1234 })).toBe(
      "3 dropped of 1,234",
    );
    expect(framesLine(null)).toBeNull();
  });

  it("measures the buffer ahead of the playhead, in the range it is in", () => {
    expect(bufferAhead(ranges([0, 10], [20, 42.5]), 30)).toBe(12.5);
    expect(bufferAhead(ranges([0, 10]), 15)).toBe(0);
    expect(bufferAhead(ranges(), 0)).toBe(0);
  });

  it("finds the newest segment the player fetched, and says how fast it came", () => {
    const entries = [
      {
        name: `http://h${url}/seg-3.m4s`,
        encodedBodySize: 5_000_000,
        requestStart: 100,
        responseEnd: 600,
      },
      {
        name: `http://h${url}/index.m3u8`,
        encodedBodySize: 900,
        requestStart: 900,
        responseEnd: 950,
      },
      {
        name: `http://h${url}/seg-4.m4s`,
        encodedBodySize: 7_700_000,
        requestStart: 1000,
        responseEnd: 1800,
      },
    ];
    const seg = lastSegment(entries);
    expect(seg).toEqual({ bytes: 7_700_000, seconds: 0.8 });
    expect(networkLine(seg)).toBe("last segment 7.7 MB in 0.8 s (77 Mb/s)");
    expect(lastSegment(entries.slice(1, 2))).toBeNull();
  });
});
