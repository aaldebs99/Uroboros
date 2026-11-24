import { describe, expect, it } from "vitest";
import { JELLYFIN_FFMPEG_DIR, transcoderPaths } from "./binaries.ts";

describe("transcoderPaths", () => {
  it("uses jellyfin-ffmpeg where the image installs it", () => {
    const paths = transcoderPaths((p) => p === `${JELLYFIN_FFMPEG_DIR}/ffmpeg`);
    expect(paths).toEqual({
      ffmpeg: "/usr/lib/jellyfin-ffmpeg/ffmpeg",
      ffprobe: "/usr/lib/jellyfin-ffmpeg/ffprobe",
      jellyfin: true,
    });
  });

  it("falls back to ffmpeg and ffprobe on PATH outside the image", () => {
    expect(transcoderPaths(() => false)).toEqual({
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      jellyfin: false,
    });
  });
});
