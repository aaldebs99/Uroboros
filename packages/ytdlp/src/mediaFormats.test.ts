import { afterEach, describe, expect, it } from "vitest";
import { baseArgs } from "./args.ts";
import { exportArgs, type ExportPlan } from "./exportArgs.ts";
import { sessionArgs, type RunPlan } from "./ffmpegArgs.ts";
import { inputArgs } from "./ffprobe.ts";
import { grabFrame } from "./frame.ts";
import { probeKeyframes } from "./keyframes.ts";
import { MEDIA_FORMATS, POSTPROCESSOR_FORMATS } from "./mediaFormats.ts";
import { previewArgs, type PreviewPlan } from "./previewArgs.ts";
import { FakeRun } from "./testFake.ts";

const runs: FakeRun[] = [];
afterEach(async () => {
  await Promise.all(runs.splice(0).map((r) => r.close()));
});

const NETWORK = "http,https,tcp,tls,crypto";
const URL_INPUT = "http://rustfs:9000/media/a.mkv?X-Amz-Signature=abc";

/**
 * The options in front of each `-i`: what ffmpeg may open that input as. A forced format (`-f`)
 * is pinned already; anything else must name the media containers and its protocols.
 */
function inputsOf(argv: readonly string[]): { opts: string[]; input: string }[] {
  const out: { opts: string[]; input: string }[] = [];
  let from = 0;
  argv.forEach((a, i) => {
    if (a !== "-i") return;
    out.push({ opts: argv.slice(from, i), input: argv[i + 1] ?? "" });
    from = i + 2;
  });
  return out;
}

const valueOf = (opts: readonly string[], flag: string) =>
  opts.includes(flag) ? opts[opts.lastIndexOf(flag) + 1] : undefined;

function expectPinned(argv: readonly string[]): void {
  const inputs = inputsOf(argv);
  expect(inputs.length).toBeGreaterThan(0);
  for (const { opts, input } of inputs) {
    if (opts.includes("-f")) continue;
    expect(valueOf(opts, "-format_whitelist"), input).toBe(MEDIA_FORMATS);
    expect(valueOf(opts, "-protocol_whitelist"), input).toBe(
      /^https?:/.test(input) ? NETWORK : "file",
    );
  }
}

const run: RunPlan = {
  input: "/media/a.mkv",
  start: 6,
  mode: "encode",
  video: {
    index: 0,
    copy: false,
    width: 1280,
    height: 720,
    bitrate: 4_000_000,
    level: 32,
    hdr: null,
    pipeline: "cpu",
  },
  audio: { index: 1, copy: true },
  vaapiDevice: "/dev/dri/renderD128",
};

const exported: ExportPlan = {
  input: "/media/a.webm",
  output: "/work/copy.mp4",
  ranges: [{ start: 0, end: 10 }],
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
  chapters: "/work/chapters.txt",
  title: "A video",
};

const preview: PreviewPlan = {
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
};

describe("a downloaded or stored file is only ever read as a media container", () => {
  it("probes a local file or a URL with the media containers pinned", () => {
    expectPinned(inputArgs("/work/x.mp4"));
    expectPinned(inputArgs(URL_INPUT));
  });

  it("keeps a narrower list a caller asks for (an upload's)", () => {
    expect(valueOf(inputArgs("/work/u.mp4", "mov,avi"), "-format_whitelist")).toBe("mov,avi");
  });

  it("plays a file or a URL back with every input pinned", () => {
    expectPinned(sessionArgs(run));
    expectPinned(sessionArgs({ ...run, input: URL_INPUT }));
  });

  it("makes hover previews and cut copies with every input pinned", () => {
    expectPinned(previewArgs(preview));
    expectPinned(previewArgs({ ...preview, input: URL_INPUT }));
    expectPinned(exportArgs(exported));
    expectPinned(exportArgs({ ...exported, input: URL_INPUT }));
  });

  it("reads keyframes and frames with the input pinned", async () => {
    const keys = await FakeRun.create({ steps: [{ stdout: "0.000000,K__\n" }] });
    runs.push(keys);
    await probeKeyframes("/media/a.mkv", { ...keys.options, streamIndex: 0 });
    expectPinned(await keys.argv());

    const frame = await FakeRun.create({ steps: [{ stdoutBase64: "/9j/2Q==" }] });
    runs.push(frame);
    await grabFrame("/media/a.mkv", { ...frame.options, atSeconds: 0 }).catch(() => undefined);
    expectPinned(await frame.argv());
  });
});

describe("yt-dlp's own ffmpeg steps", () => {
  const ppa = (argv: readonly string[]) =>
    new Map(
      argv.flatMap((a, i) => {
        if (a !== "--postprocessor-args") return [];
        const v = argv[i + 1] ?? "";
        const at = v.indexOf(":");
        return [[v.slice(0, at), v.slice(at + 1)] as const];
      }),
    );

  it("pin every input of every ffmpeg post-processor to media, subtitles and images", () => {
    const given = ppa(baseArgs({ cookies: null, netrcDir: null }));
    for (const pp of ["Merger", "VideoRemuxer", "EmbedThumbnail", "Metadata", "FixupM3u8"]) {
      expect(given.get(`${pp}+ffmpeg_i`)).toBe(
        `-format_whitelist ${POSTPROCESSOR_FORMATS} -protocol_whitelist file`,
      );
    }
  });

  it("let the steps that cut or join by a concat list read that list too", () => {
    const given = ppa(baseArgs({ cookies: null, netrcDir: null }));
    for (const pp of ["ModifyChapters", "Concat"]) {
      expect(given.get(`${pp}+ffmpeg_i`)).toBe(
        `-format_whitelist concat,${POSTPROCESSOR_FORMATS} -protocol_whitelist file`,
      );
    }
  });
});
