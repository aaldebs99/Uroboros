import { describe, expect, it } from "vitest";
import {
  chaptersMetadata,
  exportArgs,
  exportFilterGraph,
  progressSeconds,
  type ExportPlan,
} from "./exportArgs.ts";

const plan = (over: Partial<ExportPlan> = {}): ExportPlan => ({
  input: "/media/a.webm",
  output: "/work/copy.mp4",
  ranges: [
    { start: 0, end: 49.04 },
    { start: 69, end: null },
  ],
  video: {
    index: 0,
    pipeline: "cpu",
    width: 1920,
    height: 1080,
    bitrate: 12_000_000,
    level: 42,
    hdr: null,
  },
  audio: { index: 1 },
  vaapiDevice: "/dev/dri/renderD128",
  chapters: null,
  title: "A video",
  ...over,
});

describe("exportFilterGraph", () => {
  it("trims each kept range from the video and audio, joins them, then runs the pipeline's filters", () => {
    expect(exportFilterGraph(plan()).split(";")).toEqual([
      "[0:0]trim=start=0.000:end=49.040,setpts=PTS-STARTPTS[v0]",
      "[0:1]atrim=start=0.000:end=49.040,asetpts=PTS-STARTPTS[a0]",
      "[0:0]trim=start=69.000,setpts=PTS-STARTPTS[v1]",
      "[0:1]atrim=start=69.000,asetpts=PTS-STARTPTS[a1]",
      "[v0][a0][v1][a1]concat=n=2:v=1:a=1[vj][a]",
      "[vj]scale=1920:1080,format=yuv420p[v]",
    ]);
  });

  it("joins video alone when there is no audio, and uploads to the GPU on a -sw pipeline", () => {
    const graph = exportFilterGraph(
      plan({ audio: null, video: { ...plan().video, pipeline: "nvenc-sw" } }),
    );
    expect(graph).toContain("[v0][v1]concat=n=2:v=1:a=0[vj]");
    expect(graph).not.toContain("atrim");
    expect(graph.endsWith("[vj]scale=1920:1080,format=yuv420p,hwupload_cuda[v]")).toBe(true);
  });
});

describe("exportArgs", () => {
  it("seeks a clip's input with -ss right before its -i, never the chapters'", () => {
    const args = exportArgs(
      plan({ seek: 62, ranges: [{ start: 0, end: 28 }], chapters: "/work/chapters.txt" }),
    );
    const media = args.indexOf("/media/a.webm");
    expect(args.slice(media - 3, media + 1)).toEqual(["-ss", "62.000", "-i", "/media/a.webm"]);
    expect(args.filter((a) => a === "-ss")).toHaveLength(1);
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("/work/chapters.txt"));
  });

  it("seeks nothing without a seek", () => {
    expect(exportArgs(plan())).not.toContain("-ss");
    expect(exportArgs(plan({ seek: null }))).not.toContain("-ss");
  });

  it("encodes H.264 and AAC into an MP4 with progress on stdout and no source chapters", () => {
    const args = exportArgs(plan());
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(after("-progress")).toBe("pipe:1");
    expect(after("-i")).toBe("/media/a.webm");
    expect(after("-c:v")).toBe("libx264");
    expect(after("-c:a")).toBe("aac");
    expect(after("-map_chapters")).toBe("-1");
    expect(after("-map_metadata")).toBe("-1");
    expect(after("-metadata")).toBe("title=A video");
    expect(after("-movflags")).toBe("+faststart");
    expect(args.at(-1)).toBe("/work/copy.mp4");
    expect(args.filter((a) => a === "-map")).toHaveLength(2);
  });

  it("reads the chapters from an ffmetadata input, and reconnects to a URL", () => {
    const args = exportArgs(plan({ chapters: "/work/chapters.txt", input: "https://s3/x?sig" }));
    expect(args.join(" ")).toContain("-reconnect 1");
    expect(args.join(" ")).toContain("-f ffmetadata -i /work/chapters.txt");
    expect(args[args.indexOf("-map_chapters") + 1]).toBe("1");
    expect(args[args.indexOf("-map_metadata") + 1]).toBe("1");
  });

  it("sets up the GPU before the input on a GPU pipeline", () => {
    const args = exportArgs(plan({ video: { ...plan().video, pipeline: "vaapi-sw" } }));
    expect(args.indexOf("-init_hw_device")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.indexOf("-c:v") + 1]).toBe("h264_vaapi");
  });
});

describe("chaptersMetadata", () => {
  it("writes ffmetadata chapters in milliseconds, escaping the specials", () => {
    expect(
      chaptersMetadata([
        { start: 0, end: 58.284, title: "Intro" },
        { start: 58.284, end: 120, title: "A=B; #1 \\ go" },
      ]),
    ).toBe(
      [
        ";FFMETADATA1",
        "[CHAPTER]",
        "TIMEBASE=1/1000",
        "START=0",
        "END=58284",
        "title=Intro",
        "[CHAPTER]",
        "TIMEBASE=1/1000",
        "START=58284",
        "END=120000",
        "title=A\\=B\\; \\#1 \\\\ go",
        "",
      ].join("\n"),
    );
  });
});

describe("progressSeconds", () => {
  it("reads out_time_us (and the misnamed out_time_ms), ignoring other lines", () => {
    expect(progressSeconds("out_time_us=12500000")).toBe(12.5);
    expect(progressSeconds("out_time_ms=3000000")).toBe(3);
    expect(progressSeconds("out_time=00:00:12.500000")).toBeNull();
    expect(progressSeconds("progress=continue")).toBeNull();
    expect(progressSeconds("out_time_us=N/A")).toBeNull();
  });
});
