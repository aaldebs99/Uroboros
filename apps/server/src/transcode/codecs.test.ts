import { describe, expect, it } from "vitest";
import { audioCodecString, COPYABLE_AUDIO, COPYABLE_VIDEO, videoCodecString } from "./codecs.ts";

const video = (o: Partial<Parameters<typeof videoCodecString>[0]>) =>
  videoCodecString({
    codec: "h264",
    profile: "High",
    level: 40,
    pixFmt: "yuv420p",
    width: 1920,
    height: 1080,
    fps: 30,
    ...o,
  });

describe("videoCodecString", () => {
  it("writes H.264's profile and level from ffprobe", () => {
    expect(video({})).toBe("avc1.640028");
    expect(video({ profile: "Main", level: 31 })).toBe("avc1.4d001f");
    expect(video({ profile: "Constrained Baseline", level: 30 })).toBe("avc1.42e01e");
    expect(video({ profile: "High 10", level: 51, pixFmt: "yuv420p10le" })).toBe("avc1.6e0033");
  });

  it("falls back to a level for the size when ffprobe has none", () => {
    expect(video({ level: null })).toBe("avc1.64002a");
  });

  it("writes HEVC, VP9 and AV1 with their bit depth", () => {
    expect(video({ codec: "hevc", profile: "Main", level: 120 })).toBe("hvc1.1.6.L120.B0");
    expect(video({ codec: "hevc", profile: "Main 10", level: 153, pixFmt: "yuv420p10le" })).toBe(
      "hvc1.2.4.L153.B0",
    );
    expect(
      video({ codec: "vp9", profile: "Profile 0", level: null, width: 1280, height: 720 }),
    ).toBe("vp09.00.31.08");
    expect(video({ codec: "vp9", profile: "Profile 2", pixFmt: "yuv420p10le", level: null })).toBe(
      "vp09.02.40.10",
    );
    expect(video({ codec: "vp9", profile: "Profile 0", level: null, fps: 60 })).toBe(
      "vp09.00.41.08",
    );
    expect(video({ codec: "av1", profile: "Main", level: 8, pixFmt: "yuv420p10le" })).toBe(
      "av01.0.08M.10",
    );
    expect(video({ codec: "av1", profile: "Main", level: null, width: 3840, height: 2160 })).toBe(
      "av01.0.12M.08",
    );
  });

  it("prefers ffprobe's own string when it has one", () => {
    expect(video({ profile: "Constrained Baseline", mime: "avc1.42c028" })).toBe("avc1.42c028");
    expect(video({ codec: "av1", mime: "av01.0.08M.10.0.110.02.02.09.0" })).toBe(
      "av01.0.08M.10.0.110.02.02.09.0",
    );
    expect(video({ codec: "hevc", profile: "Main", level: 120, mime: null })).toBe(
      "hvc1.1.6.L120.B0",
    );
    expect(audioCodecString({ codec: "aac", profile: "LC", mime: "mp4a.40.2" })).toBe("mp4a.40.2");
  });

  it("has no string for a codec no browser takes in MP4 or WebM", () => {
    expect(video({ codec: "mpeg2video" })).toBeNull();
    expect(video({ codec: "vp8" })).toBe("vp8");
  });
});

describe("audioCodecString", () => {
  it("names each audio codec", () => {
    expect(audioCodecString({ codec: "aac", profile: "LC" })).toBe("mp4a.40.2");
    expect(audioCodecString({ codec: "aac", profile: "HE-AAC" })).toBe("mp4a.40.5");
    expect(audioCodecString({ codec: "aac", profile: "HE-AACv2" })).toBe("mp4a.40.29");
    expect(audioCodecString({ codec: "opus", profile: null })).toBe("opus");
    expect(audioCodecString({ codec: "mp3", profile: null })).toBe("mp4a.6B");
    expect(audioCodecString({ codec: "ac3", profile: null })).toBe("ac-3");
    expect(audioCodecString({ codec: "eac3", profile: null })).toBe("ec-3");
    expect(audioCodecString({ codec: "flac", profile: null })).toBe("flac");
    expect(audioCodecString({ codec: "vorbis", profile: null })).toBe("vorbis");
    expect(audioCodecString({ codec: "pcm_s16le", profile: null })).toBeNull();
  });
});

describe("what fragmented MP4 can carry as it is", () => {
  it("copies these video and audio codecs, and nothing else", () => {
    expect([...COPYABLE_VIDEO].sort()).toEqual(["av1", "h264", "hevc", "vp9"]);
    expect([...COPYABLE_AUDIO].sort()).toEqual([
      "aac",
      "ac3",
      "alac",
      "eac3",
      "flac",
      "mp3",
      "opus",
    ]);
  });
});
