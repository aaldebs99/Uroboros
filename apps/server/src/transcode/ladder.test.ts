import { describe, expect, it } from "vitest";
import { h264Level, outputSize, rungFor, rungsFor, RUNGS } from "./ladder.ts";

describe("the ladder", () => {
  it("has the six rungs with their bitrate caps", () => {
    expect(RUNGS.map((r) => [r.short, r.bitrate])).toEqual([
      [2160, 20_000_000],
      [1440, 12_000_000],
      [1080, 8_000_000],
      [720, 4_000_000],
      [480, 1_500_000],
      [360, 800_000],
    ]);
  });

  it("offers only rungs up to the source's short side", () => {
    expect(rungsFor(1920, 1080)).toEqual([1080, 720, 480, 360]);
    expect(rungsFor(3840, 2160)).toEqual([2160, 1440, 1080, 720, 480, 360]);
    // A vertical video is measured on its short side too.
    expect(rungsFor(1080, 1920)).toEqual([1080, 720, 480, 360]);
    expect(rungsFor(640, 360)).toEqual([360]);
    expect(rungsFor(320, 240)).toEqual([]);
  });

  it("gives an unlisted size the cap of the next rung up", () => {
    expect(rungFor(1080).bitrate).toBe(8_000_000);
    expect(rungFor(900).bitrate).toBe(8_000_000);
    expect(rungFor(200).bitrate).toBe(800_000);
    expect(rungFor(4320).bitrate).toBe(20_000_000);
  });
});

describe("outputSize", () => {
  it("scales the short side to the rung, keeping the aspect, both even", () => {
    expect(outputSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
    expect(outputSize(1918, 1080, 480)).toEqual({ width: 852, height: 480 });
    expect(outputSize(853, 479, 360)).toEqual({ width: 642, height: 360 });
  });

  it("never scales up, and rounds an odd source to even", () => {
    expect(outputSize(1280, 720, 1080)).toEqual({ width: 1280, height: 720 });
    expect(outputSize(1279, 719, 1080)).toEqual({ width: 1280, height: 720 });
  });
});

describe("h264Level", () => {
  it("picks the lowest level that carries the size at up to 60 fps", () => {
    expect(h264Level(640, 360)).toEqual({ idc: 31, codec: "avc1.64001f" });
    expect(h264Level(1280, 720)).toEqual({ idc: 32, codec: "avc1.640020" });
    expect(h264Level(1920, 1080)).toEqual({ idc: 42, codec: "avc1.64002a" });
    expect(h264Level(2560, 1440)).toEqual({ idc: 51, codec: "avc1.640033" });
    expect(h264Level(3840, 2160)).toEqual({ idc: 52, codec: "avc1.640034" });
  });
});
