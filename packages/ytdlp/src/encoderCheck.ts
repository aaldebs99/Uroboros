import { type Pipeline, videoEncoderArgs } from "./ffmpegVideo.ts";
import { DEFAULT_KILL_GRACE_MS, DEFAULT_STDERR_TAIL_LINES, runProcess } from "./process.ts";
import { meaningfulLine } from "./streamProcess.ts";

export interface EncoderCheckOptions {
  binary?: string;
  pipeline: Pipeline;
  vaapiDevice: string;
  env?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type EncoderCheck = { ok: true } | { ok: false; error: string };

const CHECK_TIMEOUT_MS = 20_000;

/** Device setup and the filters that put test frames on the GPU and scale them there. */
function pipelineArgs(pipeline: Pipeline, device: string): { pre: string[]; filter: string } {
  if (pipeline.startsWith("nvenc")) {
    return {
      pre: ["-init_hw_device", "cuda=cu", "-filter_hw_device", "cu"],
      filter: "format=yuv420p,hwupload_cuda,scale_cuda=w=640:h=360",
    };
  }
  if (pipeline.startsWith("vaapi")) {
    return {
      pre: ["-init_hw_device", `vaapi=va:${device}`, "-filter_hw_device", "va"],
      filter: "format=nv12,hwupload,scale_vaapi=w=640:h=360:format=nv12",
    };
  }
  return { pre: [], filter: "scale=640:360,format=yuv420p" };
}

/**
 * Encodes a second of generated video with a pipeline's upload, scaler and encoder, to find out
 * at startup whether this replica's GPU works (docs/transcoding.md). Never throws.
 */
export async function checkEncoder(o: EncoderCheckOptions): Promise<EncoderCheck> {
  const { pre, filter } = pipelineArgs(o.pipeline, o.vaapiDevice);
  const encoder = videoEncoderArgs({
    pipeline: o.pipeline,
    width: 640,
    height: 360,
    bitrate: 1_000_000,
    level: 31,
    hdr: null,
  });
  try {
    const result = await runProcess({
      binary: o.binary ?? "ffmpeg",
      args: [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        ...pre,
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=1280x720:r=30:d=1",
        "-vf",
        filter,
        ...encoder,
        "-f",
        "null",
        "-",
      ],
      env: o.env,
      signal: o.signal,
      timeoutMs: o.timeoutMs ?? CHECK_TIMEOUT_MS,
      killGraceMs: DEFAULT_KILL_GRACE_MS,
      stderrTailLines: DEFAULT_STDERR_TAIL_LINES,
    });
    if (result.exitCode === 0 && result.stopped === null) return { ok: true };
    return { ok: false, error: result.stopped ?? meaningfulLine(result.stderrTail) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
