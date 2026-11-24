import { afterEach, describe, expect, it, vi } from "vitest";

import { canPlayOriginal, capabilities, hasNativeHls, originalType } from "./playable";

const probe = (answer: (type: string) => string) =>
  ({ canPlayType: answer }) as unknown as HTMLVideoElement;
const facts = (
  o: Partial<{ container: string | null; videoCodecs: string | null; audioCodecs: string | null }>,
) => ({
  container: "webm",
  videoCodecs: "vp09.00.40.08",
  audioCodecs: "opus",
  ...o,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("originalType", () => {
  it("names the file with its exact codec strings", () => {
    expect(originalType(facts({}))).toBe('video/webm; codecs="vp09.00.40.08, opus"');
    expect(
      originalType(
        facts({ container: "mp4", videoCodecs: "avc1.6e0028", audioCodecs: "mp4a.40.2" }),
      ),
    ).toBe('video/mp4; codecs="avc1.6e0028, mp4a.40.2"');
    expect(
      originalType(facts({ container: "m4a", videoCodecs: null, audioCodecs: "mp4a.40.2" })),
    ).toBe('audio/mp4; codecs="mp4a.40.2"');
    expect(
      originalType(facts({ container: "mp3", videoCodecs: null, audioCodecs: "mp4a.6B" })),
    ).toBe("audio/mpeg");
  });

  it("has none for MKV, an unknown codec, or no streams at all", () => {
    expect(originalType(facts({ container: "mkv" }))).toBeNull();
    expect(originalType(facts({ videoCodecs: null, audioCodecs: null }))).toBeNull();
    expect(originalType(facts({ container: null }))).toBeNull();
  });
});

describe("canPlayOriginal", () => {
  it("asks the browser about the file as it is", () => {
    const asked: string[] = [];
    expect(
      canPlayOriginal(
        facts({}),
        probe((t) => {
          asked.push(t);
          return "maybe";
        }),
      ),
    ).toBe(true);
    expect(asked).toEqual(['video/webm; codecs="vp09.00.40.08, opus"']);
    expect(
      canPlayOriginal(
        facts({}),
        probe(() => ""),
      ),
    ).toBe(false);
    expect(
      canPlayOriginal(
        facts({ container: "mkv" }),
        probe(() => "probably"),
      ),
    ).toBe(false);
  });
});

describe("capabilities", () => {
  it("asks MSE whether the codecs play from fragmented MP4", () => {
    const asked: string[] = [];
    vi.stubGlobal("MediaSource", {
      isTypeSupported: (t: string) => {
        asked.push(t);
        return t.includes("vp09");
      },
    });
    expect(
      capabilities(
        facts({}),
        probe(() => ""),
      ),
    ).toEqual({ copyVideo: true, copyAudio: false });
    expect(asked).toEqual(['video/mp4; codecs="vp09.00.40.08"', 'audio/mp4; codecs="opus"']);
  });

  it("asks the element where the browser plays HLS itself", () => {
    const p = probe((t) =>
      t === "application/vnd.apple.mpegurl" || t.includes("mp4a") ? "maybe" : "",
    );
    expect(capabilities(facts({ audioCodecs: "mp4a.40.2" }), p)).toEqual({
      copyVideo: false,
      copyAudio: true,
    });
  });

  it("copies nothing it has no codec string for", () => {
    vi.stubGlobal("MediaSource", { isTypeSupported: () => true });
    expect(
      capabilities(
        facts({ videoCodecs: null, audioCodecs: null }),
        probe(() => ""),
      ),
    ).toEqual({
      copyVideo: false,
      copyAudio: false,
    });
  });
});

describe("hasNativeHls", () => {
  it("is Safari's and iOS's own HLS", () => {
    expect(hasNativeHls(probe((t) => (t === "application/vnd.apple.mpegurl" ? "maybe" : "")))).toBe(
      true,
    );
    expect(hasNativeHls(probe(() => ""))).toBe(false);
  });
});
