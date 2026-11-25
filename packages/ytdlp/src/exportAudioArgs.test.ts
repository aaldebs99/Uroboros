import { describe, expect, it } from "vitest";
import {
  audioEncoderFor,
  audioExportArgs,
  audioMuxerFor,
  coverFits,
  type AudioExportPlan,
} from "./exportAudioArgs.ts";
import { MEDIA_FORMATS } from "./mediaFormats.ts";

const plan: AudioExportPlan = {
  input: "/media/song.mp3",
  output: "/work/copy.mp3",
  ranges: [
    { start: 0, end: 10 },
    { start: 25, end: null },
  ],
  audio: { index: 0 },
  cover: { index: 1 },
  encoder: ["-c:a", "libmp3lame", "-q:a", "0"],
  muxer: "mp3",
  chapters: "/work/chapters.txt",
};

const after = (argv: readonly string[], flag: string) => argv[argv.indexOf(flag) + 1];
/** The value of the last `flag`: the output's options come after the inputs'. */
const lastAfter = (argv: readonly string[], flag: string) => argv[argv.lastIndexOf(flag) + 1];

describe("a copy of an audio file without some of it (docs/transcoding.md)", () => {
  it("trims and joins the kept ranges with atrim and concat a=1", () => {
    expect(after(audioExportArgs(plan), "-filter_complex")).toBe(
      "[0:0]atrim=start=0.000:end=10.000,asetpts=PTS-STARTPTS[a0];" +
        "[0:0]atrim=start=25.000,asetpts=PTS-STARTPTS[a1];" +
        "[a0][a1]concat=n=2:v=0:a=1[a]",
    );
  });

  it("encodes with the source's codec into its own container, progress on stdout", () => {
    const argv = audioExportArgs(plan);
    expect(argv.join(" ")).toContain("-map [a] -c:a libmp3lame -q:a 0");
    expect(lastAfter(argv, "-f")).toBe("mp3");
    expect(argv.at(-1)).toBe("/work/copy.mp3");
    expect(after(argv, "-progress")).toBe("pipe:1");
  });

  it("keeps the cover by stream copy as an attached picture where the muxer takes one", () => {
    const argv = audioExportArgs(plan);
    expect(argv.join(" ")).toContain("-map 0:1 -c:v copy -disposition:v attached_pic");
    const ogg = audioExportArgs({ ...plan, muxer: "ogg", cover: { index: 1 } });
    expect(ogg).not.toContain("0:1");
  });

  it("keeps the source's tags and takes the chapters file's chapters", () => {
    const argv = audioExportArgs(plan);
    expect(argv.join(" ")).toContain("-f ffmetadata -i /work/chapters.txt");
    expect(after(argv, "-map_metadata")).toBe("0");
    // Ogg (Opus, Vorbis) keeps its tags on the audio stream, which a filter graph's output doesn't
    // inherit: they're mapped across too.
    expect(argv.join(" ")).toContain("-map_metadata:s:a 0:s:a:0");
    expect(after(argv, "-map_chapters")).toBe("1");
    const bare = audioExportArgs({ ...plan, chapters: null });
    expect(after(bare, "-map_chapters")).toBe("-1");
  });

  it("pins the input to the media containers", () => {
    const argv = audioExportArgs(plan);
    const i = argv.indexOf("/media/song.mp3");
    expect(argv[i - 1]).toBe("-i");
    expect(argv.slice(0, i)).toContain("-format_whitelist");
    expect(after(argv.slice(0, i), "-format_whitelist")).toBe(MEDIA_FORMATS);
    expect(after(argv.slice(0, i), "-protocol_whitelist")).toBe("file");
  });

  it("maps codecs and extensions; one it doesn't know is null", () => {
    expect(audioEncoderFor("mp3")).toEqual(["-c:a", "libmp3lame", "-q:a", "0"]);
    expect(audioEncoderFor("opus")).toEqual(["-c:a", "libopus", "-b:a", "160k"]);
    expect(audioEncoderFor("vorbis")).toEqual(["-c:a", "libvorbis", "-q:a", "6"]);
    expect(audioEncoderFor("aac")).toEqual(["-c:a", "aac", "-b:a", "256k"]);
    expect(audioEncoderFor("flac")).toEqual(["-c:a", "flac"]);
    expect(audioEncoderFor("alac")).toEqual(["-c:a", "alac"]);
    expect(audioEncoderFor("pcm_s24le")).toEqual(["-c:a", "pcm_s24le"]);
    expect(audioEncoderFor("wmav2")).toBeNull();
    expect(audioEncoderFor(null)).toBeNull();
    expect(audioMuxerFor("m4a")).toBe("ipod");
    expect(audioMuxerFor("opus")).toBe("opus");
    expect(audioMuxerFor("webm")).toBe("webm");
    expect(audioMuxerFor("oga")).toBe("ogg");
    expect(audioMuxerFor("aac")).toBe("adts");
    expect(audioMuxerFor("wma")).toBeNull();
    expect(coverFits("ipod")).toBe(true);
    expect(coverFits("opus")).toBe(false);
  });
});
