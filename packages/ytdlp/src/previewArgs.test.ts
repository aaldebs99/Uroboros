import { describe, expect, it } from "vitest";
import { previewArgs, type PreviewPlan } from "./previewArgs.ts";
import { MEDIA_FORMATS } from "./mediaFormats.ts";

const plan = (over: Partial<PreviewPlan> = {}): PreviewPlan => ({
  input: "/media/a.webm",
  output: "/work/preview.mp4",
  video: {
    index: 0,
    pipeline: "cpu",
    width: 640,
    height: 360,
    bitrate: 600_000,
    level: 30,
    hdr: null,
  },
  audio: { index: 1 },
  ...over,
});

const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("previewArgs", () => {
  it("reads the whole file once, pinned to the media containers", () => {
    const args = previewArgs(plan());
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(args).not.toContain("-ss");
    expect(args).not.toContain("-t");
    const open = args.indexOf("-i");
    expect(args.slice(open - 4, open + 2)).toEqual([
      "-protocol_whitelist",
      "file",
      "-format_whitelist",
      MEDIA_FORMATS,
      "-i",
      "/media/a.webm",
    ]);
  });

  it("reconnects to a URL", () => {
    expect(previewArgs(plan({ input: "https://s3/x?sig" })).join(" ")).toContain("-reconnect 1");
  });

  it("maps the video and the audio streams it was given", () => {
    const args = previewArgs(plan({ video: { ...plan().video, index: 2 }, audio: { index: 5 } }));
    const maps = args.flatMap((a, i) => (a === "-map" ? [args[i + 1]] : []));
    expect(maps).toEqual(["0:2", "0:5"]);
  });

  it("scales on the CPU, and tone-maps an HDR source", () => {
    expect(after(previewArgs(plan()), "-vf")).toBe("scale=640:360,format=yuv420p");
    const hdr = previewArgs(plan({ video: { ...plan().video, hdr: "smpte2084" } }));
    expect(after(hdr, "-vf")).toContain("tonemapx=");
  });

  it("encodes H.264 with stereo AAC into an MP4 that starts at once", () => {
    const args = previewArgs(plan());
    expect(after(args, "-c:v")).toBe("libx264");
    expect(after(args, "-maxrate")).toBe("600000");
    expect(after(args, "-c:a")).toBe("aac");
    expect(after(args, "-b:a")).toBe("96k");
    expect(after(args, "-ac")).toBe("2");
    expect(args).toContain("-sn");
    expect(args).toContain("-dn");
    expect(after(args, "-map_metadata")).toBe("-1");
    expect(after(args, "-map_chapters")).toBe("-1");
    expect(after(args, "-movflags")).toBe("+faststart");
    expect(args.at(-1)).toBe("/work/preview.mp4");
  });

  it("stays silent when the file has no sound", () => {
    const args = previewArgs(plan({ audio: null }));
    expect(args.filter((a) => a === "-map")).toHaveLength(1);
    expect(args).toContain("-an");
    expect(args).not.toContain("-c:a");
  });
});
