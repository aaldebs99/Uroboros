import { audioMuxerFor } from "@uroboros/ytdlp";
import { describe, expect, it } from "vitest";
import { AUDIO_COPY_FORMATS, exportFormatFor } from "./formats.ts";

describe("what a copy is made as", () => {
  it("offers only the audio containers the export job can write", () => {
    for (const ext of AUDIO_COPY_FORMATS) expect(audioMuxerFor(ext), ext).not.toBeNull();
    expect(audioMuxerFor("wma")).toBeNull();
    expect(AUDIO_COPY_FORMATS.has("wma")).toBe(false);
  });

  it("is MP4 for a video, the audio file's own container for audio, or none", () => {
    expect(exportFormatFor({ video_codec: "vp9", container: "webm" })).toBe("mp4");
    expect(exportFormatFor({ video_codec: null, container: "MP3" })).toBe("mp3");
    expect(exportFormatFor({ video_codec: null, container: "wma" })).toBeNull();
    expect(exportFormatFor({ video_codec: null, container: null })).toBeNull();
  });
});
