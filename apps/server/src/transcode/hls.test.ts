import { describe, expect, it } from "vitest";
import { masterPlaylist, mediaPlaylist } from "./hls.ts";

describe("masterPlaylist", () => {
  it("states the one variant's bandwidth, codecs and size", () => {
    expect(
      masterPlaylist({
        bandwidth: 4_000_000,
        codecs: ["avc1.640020", "mp4a.40.2"],
        resolution: { width: 1280, height: 720 },
        media: "sessions/abc/index.m3u8",
      }),
    ).toBe(
      [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        "#EXT-X-INDEPENDENT-SEGMENTS",
        '#EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="avc1.640020,mp4a.40.2",RESOLUTION=1280x720',
        "sessions/abc/index.m3u8",
        "",
      ].join("\n"),
    );
  });

  it("names no audio codec for a silent video, and no size for audio", () => {
    expect(
      masterPlaylist({ bandwidth: 1, codecs: ["avc1.640020"], resolution: null, media: "m" }),
    ).toContain('CODECS="avc1.640020"\nm');
  });
});

describe("mediaPlaylist", () => {
  it("lists every segment of the whole video at once, VOD, with its init", () => {
    const text = mediaPlaylist([0, 6, 12, 13.5], {
      init: "init.mp4",
      segment: (i) => `seg-${String(i)}.m4s`,
    });
    expect(text).toBe(
      [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        "#EXT-X-TARGETDURATION:6",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-INDEPENDENT-SEGMENTS",
        '#EXT-X-MAP:URI="init.mp4"',
        "#EXTINF:6.000000,",
        "seg-0.m4s",
        "#EXTINF:6.000000,",
        "seg-1.m4s",
        "#EXTINF:1.500000,",
        "seg-2.m4s",
        "#EXT-X-ENDLIST",
        "",
      ].join("\n"),
    );
  });

  it("raises the target duration to the longest segment", () => {
    const text = mediaPlaylist([0, 10.4, 12], { init: "i", segment: (i) => String(i) });
    expect(text).toContain("#EXT-X-TARGETDURATION:11\n");
  });
});
