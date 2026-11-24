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
};

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

  it("encodes at the source's size, up to 1080 lines, when the video can't play", () => {
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
    expect(
      planSession(uhd, { quality: "original", copyVideo: false, copyAudio: true }),
    ).toMatchObject({
      width: 1920,
      height: 1080,
    });
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
