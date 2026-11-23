import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { YtDlpError } from "./errors.ts";
import { FakeRun, type Scenario } from "./testFake.ts";
import { hlsArgs, transcodeHls, type HlsPlan } from "./transcode.ts";

const runs: FakeRun[] = [];
async function fake(scenario: Scenario): Promise<FakeRun> {
  const run = await FakeRun.create(scenario);
  runs.push(run);
  return run;
}
afterEach(async () => {
  await Promise.all(runs.splice(0).map((run) => run.close()));
});

const plan = (over: Partial<HlsPlan> = {}): HlsPlan => ({
  input: "/media/in.webm",
  mode: "encode",
  encoder: "libx264",
  copyAudio: false,
  hdr: false,
  segmentSeconds: 6,
  ...over,
});

const joined = (p: HlsPlan) => hlsArgs(p).join(" ");

describe("hlsArgs", () => {
  it("builds encode arguments with libx264, 1080 lines and 6 s keyframes", () => {
    const args = hlsArgs(plan());
    expect(args.slice(0, 6)).toEqual([
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      "/media/in.webm",
      "-map",
    ]);
    const s = args.join(" ");
    expect(s).toContain("-c:v libx264 -preset veryfast -crf 23 -profile:v high -sc_threshold 0");
    expect(s).toContain("scale=-2:'min(1080,ih)',format=yuv420p");
    expect(s).toContain("-force_key_frames expr:gte(t,n_forced*6)");
    expect(s).toContain("-c:a aac -b:a 160k -ac 2");
    expect(s).toContain(
      "-f hls -hls_time 6 -hls_playlist_type event -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 -hls_segment_filename seg-%05d.m4s",
    );
    expect(args.at(-1)).toBe("index.m3u8");
    expect(s).toContain("-progress pipe:1 -nostats");
  });

  it("tone-maps HDR before scaling", () => {
    const s = joined(plan({ hdr: true }));
    expect(s).toMatch(
      /zscale=t=linear:npl=100,.*tonemap=hable:desat=0,.*scale=-2:'min\(1080,ih\)'/,
    );
  });

  it("uses h264_nvenc for the nvenc encoder", () => {
    const s = joined(plan({ encoder: "nvenc" }));
    expect(s).toContain("-c:v h264_nvenc");
    expect(s).not.toContain("libx264");
  });

  it("copies the video for a remux, and the audio when asked", () => {
    expect(joined(plan({ mode: "remux" }))).toContain("-c:v copy");
    expect(joined(plan({ mode: "remux" }))).not.toContain("-force_key_frames");
    expect(joined(plan({ mode: "remux", copyAudio: true }))).toContain("-c:a copy");
  });

  it("drops video for audio", () => {
    const s = joined(plan({ mode: "audio" }));
    expect(s).toContain("-vn");
    expect(s).not.toContain("-c:v");
  });
});

describe("transcodeHls", () => {
  it("reports progress from out_time_us", async () => {
    const run = await fake({
      steps: [
        { stdout: "out_time_us=3000000\nprogress=continue\n" },
        { stdout: "out_time_us=6000000\nprogress=end\n" },
      ],
    });
    const seen: number[] = [];
    await transcodeHls(plan(), {
      ...run.options,
      cwd: await mkdtemp(join(tmpdir(), "uroboros-hls-")),
      onProgress: (s) => seen.push(s),
    });
    expect(seen).toEqual([3, 6]);
    expect((await run.argv()).at(-1)).toBe("index.m3u8");
  });

  it("throws a YtDlpError with ffmpeg's last stderr line on failure", async () => {
    const run = await fake({
      steps: [
        { stderr: "Input #0, matroska\nin.webm: Invalid data found when processing input\n" },
      ],
      exitCode: 1,
    });
    const err = await transcodeHls(plan(), {
      ...run.options,
      cwd: await mkdtemp(join(tmpdir(), "uroboros-hls-")),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YtDlpError);
    expect((err as YtDlpError).message).toBe("in.webm: Invalid data found when processing input");
  });
});

describe("ffprobe streams for transcoding", () => {
  it("keeps the pixel format and the colour transfer", async () => {
    const { MediaStream } = await import("./ffprobe.ts");
    expect(
      MediaStream.parse({
        index: 0,
        codec_type: "video",
        codec_name: "vp9",
        pix_fmt: "yuv420p10le",
        color_transfer: "smpte2084",
      }),
    ).toMatchObject({ pixFmt: "yuv420p10le", colorTransfer: "smpte2084" });
    expect(MediaStream.parse({ index: 1, codec_type: "audio" })).toMatchObject({
      pixFmt: null,
      colorTransfer: null,
    });
  });
});
