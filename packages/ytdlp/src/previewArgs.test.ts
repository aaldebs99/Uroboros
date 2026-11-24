import { describe, expect, it } from "vitest";
import {
  previewArgs,
  previewFilterGraph,
  previewWindows,
  type PreviewPlan,
} from "./previewArgs.ts";

const plan = (over: Partial<PreviewPlan> = {}): PreviewPlan => ({
  input: "/media/a.webm",
  output: "/work/preview.mp4",
  duration: 100,
  video: {
    index: 0,
    pipeline: "cpu",
    width: 640,
    height: 360,
    bitrate: 600_000,
    level: 30,
    hdr: null,
  },
  ...over,
});

describe("previewWindows", () => {
  it("takes two seconds at the start, 20%, 40%, 60% and 80%", () => {
    expect(previewWindows(100)).toEqual([
      { start: 0, length: 2 },
      { start: 20, length: 2 },
      { start: 40, length: 2 },
      { start: 60, length: 2 },
      { start: 80, length: 2 },
    ]);
  });

  it("takes a video under 15 seconds whole", () => {
    expect(previewWindows(9.5)).toEqual([{ start: 0, length: 15 }]);
    expect(previewWindows(14.99)).toHaveLength(1);
    expect(previewWindows(15)).toHaveLength(5);
  });
});

describe("previewFilterGraph", () => {
  it("starts each input's frames at 0, joins them, then scales on the CPU", () => {
    expect(previewFilterGraph(plan({ video: { ...plan().video, index: 1 } })).split(";")).toEqual([
      "[0:1]setpts=PTS-STARTPTS[v0]",
      "[1:1]setpts=PTS-STARTPTS[v1]",
      "[2:1]setpts=PTS-STARTPTS[v2]",
      "[3:1]setpts=PTS-STARTPTS[v3]",
      "[4:1]setpts=PTS-STARTPTS[v4]",
      "[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[vj]",
      "[vj]scale=640:360,format=yuv420p[v]",
    ]);
  });

  it("tone-maps an HDR source", () => {
    const graph = previewFilterGraph(plan({ video: { ...plan().video, hdr: "smpte2084" } }));
    expect(graph).toContain("tonemapx=");
  });
});

describe("previewArgs", () => {
  it("opens the file once per snippet, each seeked before it is opened", () => {
    const args = previewArgs(plan());
    const opens = args.flatMap((a, i) => (a === "-i" ? [i] : []));
    expect(opens).toHaveLength(5);
    expect(opens.map((i) => args.slice(i - 4, i + 2))).toEqual(
      ["0.000", "20.000", "40.000", "60.000", "80.000"].map((start) => [
        "-ss",
        start,
        "-t",
        "2.000",
        "-i",
        "/media/a.webm",
      ]),
    );
  });

  it("opens a short video once, and reconnects to a URL", () => {
    const args = previewArgs(plan({ duration: 8, input: "https://s3/x?sig" }));
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(args.join(" ")).toContain("-t 15.000");
    expect(args.join(" ")).toContain("-reconnect 1");
  });

  it("encodes silent H.264 into an MP4 that starts at once", () => {
    const args = previewArgs(plan());
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(after("-map")).toBe("[v]");
    expect(after("-c:v")).toBe("libx264");
    expect(after("-maxrate")).toBe("600000");
    expect(args).toContain("-an");
    expect(after("-map_metadata")).toBe("-1");
    expect(after("-map_chapters")).toBe("-1");
    expect(after("-movflags")).toBe("+faststart");
    expect(args.at(-1)).toBe("/work/preview.mp4");
  });
});
