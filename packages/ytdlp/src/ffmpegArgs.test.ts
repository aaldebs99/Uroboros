import { describe, expect, it } from "vitest";
import { sessionArgs, type RunPlan } from "./ffmpegArgs.ts";

const OUT = [
  "-avoid_negative_ts",
  "disabled",
  "-f",
  "mp4",
  "-movflags",
  "+frag_keyframe+empty_moov+default_base_moof+frag_discont+negative_cts_offsets+skip_trailer",
  "-use_editlist",
  "0",
  "-fflags",
  "+bitexact",
  "-flags:v",
  "+bitexact",
  "-flags:a",
  "+bitexact",
  "-map_metadata",
  "-1",
  "-map_chapters",
  "-1",
  "pipe:1",
];

const encode = (o: Partial<RunPlan> = {}): RunPlan => ({
  input: "/media/a.mkv",
  start: 0,
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
  ...o,
});

describe("sessionArgs", () => {
  it("encodes on the CPU from the start into fragmented MP4 on stdout", () => {
    expect(sessionArgs(encode())).toEqual([
      "-hide_banner",
      "-nostdin",
      "-v",
      "error",
      "-copyts",
      "-start_at_zero",
      "-i",
      "/media/a.mkv",
      "-map",
      "0:0",
      "-map",
      "0:1",
      "-fps_mode:v",
      "passthrough",
      "-vf",
      "scale=1280:720,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-maxrate",
      "4000000",
      "-bufsize",
      "8000000",
      "-profile:v",
      "high",
      "-level:v",
      "3.2",
      "-sc_threshold",
      "0",
      "-force_key_frames",
      "expr:gte(t,n_forced*6)",
      "-c:a",
      "copy",
      ...OUT,
    ]);
  });

  it("starts a later run at its boundary, with the audio from a second input a little earlier", () => {
    const args = sessionArgs(encode({ start: 30, audio: { index: 2, copy: false } }));
    expect(args.slice(4, 16)).toEqual([
      "-copyts",
      "-start_at_zero",
      "-ss",
      "30.0000",
      "-i",
      "/media/a.mkv",
      "-ss",
      "29.7500",
      "-i",
      "/media/a.mkv",
      "-map",
      "0:0",
    ]);
    expect(args).toContain("1:2");
    const at = args.indexOf("-c:a");
    expect(args.slice(at, at + 6)).toEqual(["-c:a", "aac", "-b:a", "160k", "-ac", "2"]);
  });

  it("decodes, scales, tone-maps and encodes on the NVIDIA GPU", () => {
    const video = { ...encode().video, pipeline: "nvenc", hdr: "smpte2084" } as RunPlan["video"];
    const args = sessionArgs(encode({ video }));
    expect(args.slice(6, 10)).toEqual(["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"]);
    expect(args[args.indexOf("-vf") + 1]).toBe(
      "setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc," +
        "scale_cuda=w=1280:h=720," +
        "tonemap_cuda=tonemap=bt2390:desat=0:peak=100:t=bt709:m=bt709:p=bt709:format=yuv420p",
    );
    const at = args.indexOf("-c:v");
    expect(args.slice(at, at + 16)).toEqual([
      "-c:v",
      "h264_nvenc",
      "-preset",
      "p4",
      "-b:v",
      "4000000",
      "-maxrate",
      "4000000",
      "-bufsize",
      "8000000",
      "-profile:v",
      "high",
      "-level:v",
      "3.2",
      "-forced-idr",
      "1",
    ]);
  });

  it("tags tone-mapped output as BT.709 on every pipeline, and leaves SDR as it is", () => {
    const tags = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"];
    for (const pipeline of ["cpu", "nvenc", "nvenc-sw", "vaapi", "vaapi-sw"] as const) {
      const hdr = sessionArgs(
        encode({ video: { ...encode().video, pipeline, hdr: "smpte2084" } as RunPlan["video"] }),
      );
      const at = hdr.indexOf("-color_primaries");
      expect(hdr.slice(at, at + 6)).toEqual(tags);
      const sdr = sessionArgs(
        encode({ video: { ...encode().video, pipeline } as RunPlan["video"] }),
      );
      expect(sdr).not.toContain("-color_primaries");
    }
  });

  it("decodes on the CPU and uploads to the GPU when the GPU can't decode the source", () => {
    const nv = sessionArgs(
      encode({ video: { ...encode().video, pipeline: "nvenc-sw" } as RunPlan["video"] }),
    );
    expect(nv.slice(6, 10)).toEqual(["-init_hw_device", "cuda=cu", "-filter_hw_device", "cu"]);
    expect(nv[nv.indexOf("-vf") + 1]).toBe("scale=1280:720,format=yuv420p,hwupload_cuda");
    const va = sessionArgs(
      encode({
        video: { ...encode().video, pipeline: "vaapi-sw", hdr: "arib-std-b67" } as RunPlan["video"],
      }),
    );
    expect(va.slice(6, 10)).toEqual([
      "-init_hw_device",
      "vaapi=va:/dev/dri/renderD128",
      "-filter_hw_device",
      "va",
    ]);
    expect(va[va.indexOf("-vf") + 1]).toBe(
      "scale=1280:720,tonemapx=tonemap=bt2390:desat=0:peak=100:t=bt709:m=bt709:p=bt709:format=nv12,hwupload",
    );
  });

  it("does it all on the VA-API device, tone-mapping on the CPU in between", () => {
    const video = { ...encode().video, pipeline: "vaapi", hdr: "smpte2084" } as RunPlan["video"];
    const args = sessionArgs(encode({ video }));
    expect(args.slice(6, 16)).toEqual([
      "-init_hw_device",
      "vaapi=va:/dev/dri/renderD128",
      "-filter_hw_device",
      "va",
      "-hwaccel",
      "vaapi",
      "-hwaccel_device",
      "va",
      "-hwaccel_output_format",
      "vaapi",
    ]);
    expect(args[args.indexOf("-vf") + 1]).toBe(
      "scale_vaapi=w=1280:h=720:format=p010,hwdownload,format=p010le," +
        "tonemapx=tonemap=bt2390:desat=0:peak=100:t=bt709:m=bt709:p=bt709:format=nv12,hwupload",
    );
    const at = args.indexOf("-c:v");
    expect(args.slice(at, at + 4)).toEqual(["-c:v", "h264_vaapi", "-rc_mode", "VBR"]);
    const sdr = sessionArgs(
      encode({ video: { ...encode().video, pipeline: "vaapi" } as RunPlan["video"] }),
    );
    expect(sdr[sdr.indexOf("-vf") + 1]).toBe("scale_vaapi=w=1280:h=720:format=nv12");
  });

  it("copies the video for a remux, seeking just past its keyframe, tagging HEVC for Safari", () => {
    const args = sessionArgs({
      input: "/media/b.mp4",
      start: 12,
      mode: "remux",
      video: { index: 0, copy: true, hevc: true },
      audio: { index: 1, copy: true },
      vaapiDevice: "/dev/dri/renderD128",
    });
    expect(args.slice(6, 14)).toEqual([
      "-ss",
      "12.0005",
      "-i",
      "/media/b.mp4",
      "-ss",
      "11.7500",
      "-i",
      "/media/b.mp4",
    ]);
    const at = args.indexOf("-c:v");
    expect(args.slice(at, at + 4)).toEqual(["-c:v", "copy", "-tag:v", "hvc1"]);
    expect(args).not.toContain("-force_key_frames");
    expect(args).not.toContain("-vf");
  });

  it("fragments an audio file at every frame, one input started a little early", () => {
    const args = sessionArgs({
      input: "/media/song.opus",
      start: 18,
      mode: "audio",
      video: null,
      audio: { index: 0, copy: false },
      vaapiDevice: "/dev/dri/renderD128",
    });
    expect(args.slice(4, 12)).toEqual([
      "-copyts",
      "-start_at_zero",
      "-ss",
      "17.7500",
      "-i",
      "/media/song.opus",
      "-map",
      "0:0",
    ]);
    expect(args).not.toContain("-fps_mode:v");
    expect(args).not.toContain("-flags:v");
    expect(args[args.indexOf("-movflags") + 1]).toBe(
      "+frag_every_frame+empty_moov+default_base_moof+frag_discont+negative_cts_offsets+skip_trailer",
    );
  });

  it("reads a URL with reconnects and only network protocols, on every input", () => {
    const url = "http://rustfs:9000/media/a.mkv?X-Amz-Signature=abc";
    const args = sessionArgs(encode({ input: url, start: 6 }));
    const net = [
      "-reconnect",
      "1",
      "-reconnect_on_network_error",
      "1",
      "-reconnect_delay_max",
      "10",
      "-protocol_whitelist",
      "http,https,tcp,tls,crypto",
    ];
    const first = args.indexOf(url);
    const second = args.lastIndexOf(url);
    expect(first).not.toBe(second);
    expect(args.slice(first - 1 - net.length, first - 1)).toEqual(net);
    expect(args.slice(second - 1 - net.length, second - 1)).toEqual(net);
  });

  it("keeps a silent video silent", () => {
    const args = sessionArgs(encode({ audio: null, start: 6 }));
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(args).not.toContain("-c:a");
    expect(args.filter((a) => a === "-map")).toHaveLength(1);
  });
});
