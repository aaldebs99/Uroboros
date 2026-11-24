import { MediaInfo } from "@uroboros/ytdlp";
import { describe, expect, it } from "vitest";
import { keyframeStream, renditionFacts } from "./facts.ts";

const info = (streams: unknown[], format: Record<string, unknown> = { duration: "60" }) =>
  MediaInfo.parse({ streams, format });

const vp9 = {
  index: 0,
  codec_type: "video",
  codec_name: "vp9",
  profile: "Profile 0",
  mime_codec_string: "vp09.00.31.08",
  width: 1280,
  height: 720,
  pix_fmt: "yuv420p",
};
const opus = { index: 1, codec_type: "audio", codec_name: "opus", mime_codec_string: "opus" };

describe("renditionFacts", () => {
  it("records the streams' codecs, size, duration and codec strings", () => {
    expect(renditionFacts(info([vp9, opus]))).toEqual({
      video_codec: "vp9",
      audio_codec: "opus",
      width: 1280,
      height: 720,
      duration: 60,
      video_codecs: "vp09.00.31.08",
      audio_codecs: "opus",
    });
  });

  it("computes a codec string ffprobe has none for (HEVC)", () => {
    const hevc = {
      index: 0,
      codec_type: "video",
      codec_name: "hevc",
      profile: "Main 10",
      level: 150,
      width: 3840,
      height: 2160,
      pix_fmt: "yuv420p10le",
    };
    expect(renditionFacts(info([hevc])).video_codecs).toBe("hvc1.2.4.L150.B0");
  });

  it("does not take a music file's cover art for its video", () => {
    const cover = {
      index: 0,
      codec_type: "video",
      codec_name: "mjpeg",
      width: 500,
      height: 500,
      disposition: { attached_pic: 1 },
    };
    expect(renditionFacts(info([cover, { ...opus, index: 1 }]))).toMatchObject({
      video_codec: null,
      width: null,
      height: null,
      video_codecs: null,
      audio_codec: "opus",
    });
  });
});

describe("keyframeStream", () => {
  it("is the video stream, when a session could copy it", () => {
    expect(keyframeStream(info([opus, { ...vp9, index: 3 }]))).toBe(3);
  });

  it("is null for audio, cover art, or a codec that is never copied", () => {
    expect(keyframeStream(info([opus]))).toBeNull();
    expect(keyframeStream(info([{ ...vp9, codec_name: "mpeg2video" }]))).toBeNull();
  });
});
