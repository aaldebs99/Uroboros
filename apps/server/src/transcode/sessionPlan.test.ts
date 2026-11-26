import { describe, expect, it } from "vitest";
import { planSession, type RenditionFacts } from "./sessionPlan.ts";

const vp9: RenditionFacts = {
  duration: 600,
  width: 1920,
  height: 1080,
  videoCodec: "vp9",
  videoCodecs: "vp09.00.40.08",
  audioCodec: "opus",
  audioCodecs: "opus",
  bitrate: null,
};

/** A 4K AV1 file at 7 Mb/s overall, as YouTube's best is. */
const av1Uhd: RenditionFacts = {
  ...vp9,
  width: 3840,
  height: 2160,
  videoCodec: "av1",
  videoCodecs: "av01.0.13M.08",
  bitrate: 7_000_000,
};
const original = { quality: "original", copyVideo: false, copyAudio: true } as const;

describe("planSession", () => {
  it("remuxes when the browser plays the codecs and only the file can't play", () => {
    expect(planSession(vp9, { quality: "original", copyVideo: true, copyAudio: true })).toEqual({
      mode: "remux",
      quality: "original",
      width: 1920,
      height: 1080,
      bitrate: null,
      level: null,
      audio: "copy",
      codecs: ["vp09.00.40.08", "opus"],
      bandwidth: 8_160_000,
      boundaries: "keyframes",
      reason: "container",
    });
  });

  it("converts the audio alone when only the audio can't play", () => {
    const plan = planSession(vp9, { quality: "original", copyVideo: true, copyAudio: false });
    expect(plan).toMatchObject({
      mode: "remux",
      audio: "aac",
      codecs: ["vp09.00.40.08", "mp4a.40.2"],
    });
    expect(plan.reason).toBe("audio_unsupported");
  });

  it("encodes at the source's size when the video can't play", () => {
    expect(
      planSession(vp9, { quality: "original", copyVideo: false, copyAudio: true }),
    ).toMatchObject({
      mode: "encode",
      width: 1920,
      height: 1080,
      bitrate: 8_000_000,
      level: 42,
      audio: "copy",
      codecs: ["avc1.64002a", "opus"],
      boundaries: "uniform",
      reason: "video_unsupported",
    });
    const uhd = { ...vp9, width: 3840, height: 2160 };
    expect(planSession(uhd, original)).toMatchObject({
      width: 3840,
      height: 2160,
      bitrate: 20_000_000,
      level: 52,
      codecs: ["avc1.640034", "opus"],
    });
  });

  it("encodes no taller than the server's maximum, Original or a picked rung", () => {
    const uhd = { ...vp9, width: 3840, height: 2160 };
    expect(planSession(uhd, original, 1080)).toMatchObject({ width: 1920, height: 1080 });
    expect(
      planSession(uhd, { quality: "2160", copyVideo: true, copyAudio: true }, 1080),
    ).toMatchObject({ width: 1920, height: 1080, bitrate: 8_000_000 });
  });

  it("follows the source's bitrate, scaled for what H.264 needs more, under the rung's cap", () => {
    // (7 Mb/s less 160 kb/s of audio) × 2 for AV1.
    expect(planSession(av1Uhd, original)).toMatchObject({
      bitrate: 13_680_000,
      bandwidth: 13_840_000,
    });
    // × 1.5 for VP9, past the 1080p cap.
    expect(planSession({ ...vp9, bitrate: 20_000_000 }, original).bitrate).toBe(8_000_000);
    // × 1.25 for H.264, a margin for encoding it again.
    const h264 = { ...vp9, videoCodec: "h264", videoCodecs: "avc1.640028", bitrate: 4_000_000 };
    expect(planSession(h264, original).bitrate).toBe(4_800_000);
    // A picked rung keeps its own cap.
    expect(planSession(av1Uhd, { ...original, quality: "720" }).bitrate).toBe(4_000_000);
  });

  it("takes no audio off a silent file's bitrate, and keeps a floor under a broken one", () => {
    const silent = { ...av1Uhd, audioCodec: null, audioCodecs: null };
    expect(planSession(silent, original).bitrate).toBe(14_000_000);
    expect(planSession({ ...av1Uhd, bitrate: 100_000 }, original).bitrate).toBe(500_000);
  });

  it("encodes a codec fragmented MP4 can't carry, even when the browser plays it", () => {
    const vp8 = {
      ...vp9,
      videoCodec: "vp8",
      videoCodecs: "vp8",
      audioCodec: "vorbis",
      audioCodecs: "vorbis",
    };
    expect(
      planSession(vp8, { quality: "original", copyVideo: true, copyAudio: true }),
    ).toMatchObject({
      mode: "encode",
      audio: "aac",
      reason: "video_not_copyable",
    });
  });

  it("encodes at a picked rung, whatever the browser plays", () => {
    expect(planSession(vp9, { quality: "720", copyVideo: true, copyAudio: true })).toMatchObject({
      mode: "encode",
      quality: "720",
      width: 1280,
      height: 720,
      bitrate: 4_000_000,
      level: 32,
      codecs: ["avc1.640020", "opus"],
      bandwidth: 4_160_000,
      reason: "picked",
    });
  });

  it("never encodes above the source for a rung it doesn't have", () => {
    expect(
      planSession(
        { ...vp9, width: 1280, height: 720 },
        { quality: "1080", copyVideo: true, copyAudio: true },
      ),
    ).toMatchObject({
      width: 1280,
      height: 720,
      bitrate: 4_000_000,
    });
  });

  it("plays an audio-only file as audio, copied or converted", () => {
    const song = { ...vp9, width: null, height: null, videoCodec: null, videoCodecs: null };
    expect(
      planSession(song, { quality: "original", copyVideo: true, copyAudio: true }),
    ).toMatchObject({
      mode: "audio",
      width: null,
      audio: "copy",
      codecs: ["opus"],
      bandwidth: 160_000,
      boundaries: "uniform",
      reason: "container",
    });
    expect(
      planSession(song, { quality: "original", copyVideo: true, copyAudio: false }).audio,
    ).toBe("aac");
  });

  it("keeps a silent video silent", () => {
    const silent = { ...vp9, audioCodec: null, audioCodecs: null };
    const plan = planSession(silent, { quality: "720", copyVideo: false, copyAudio: false });
    expect(plan.audio).toBeNull();
    expect(plan.codecs).toEqual(["avc1.640020"]);
  });
});
