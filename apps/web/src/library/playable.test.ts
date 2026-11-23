import { describe, expect, it } from "vitest";

import { canPlayOriginal, codecsFor, hasNativeHls } from "./playable";

const probe = (answer: string) => ({ canPlayType: () => answer }) as unknown as HTMLVideoElement;

describe("what this browser plays", () => {
  it("maps VP9/Opus WebM, H.264/AAC MP4 and Opus audio to MIME types", () => {
    expect(codecsFor({ container: "webm", videoCodec: "vp9", audioCodec: "opus" })).toBe(
      'video/webm; codecs="vp09.00.40.08, opus"',
    );
    expect(codecsFor({ container: "webm", videoCodec: "av1", audioCodec: "opus" })).toBe(
      'video/webm; codecs="av01.0.08M.08, opus"',
    );
    expect(codecsFor({ container: "mp4", videoCodec: "h264", audioCodec: "aac" })).toBe(
      'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    );
    expect(codecsFor({ container: "opus", videoCodec: null, audioCodec: "opus" })).toBe(
      'audio/ogg; codecs="opus"',
    );
    expect(codecsFor({ container: "m4a", videoCodec: null, audioCodec: "aac" })).toBe(
      'audio/mp4; codecs="mp4a.40.2"',
    );
    expect(codecsFor({ container: "mp3", videoCodec: null, audioCodec: "mp3" })).toBe("audio/mpeg");
  });

  it("never plays MKV natively, nor a codec it does not know", () => {
    expect(codecsFor({ container: "mkv", videoCodec: "h264", audioCodec: "aac" })).toBeNull();
    expect(codecsFor({ container: "mp4", videoCodec: "prores", audioCodec: "aac" })).toBeNull();
    expect(codecsFor({ container: null, videoCodec: null, audioCodec: null })).toBeNull();
  });

  it("asks the browser, and never for MKV", () => {
    const webm = { container: "webm", videoCodec: "vp9", audioCodec: "opus" };
    expect(canPlayOriginal(webm, probe("maybe"))).toBe(true);
    expect(canPlayOriginal(webm, probe(""))).toBe(false);
    expect(canPlayOriginal({ ...webm, container: "mkv" }, probe("probably"))).toBe(false);
    expect(hasNativeHls(probe("maybe"))).toBe(true);
    expect(hasNativeHls(probe(""))).toBe(false);
  });
});
