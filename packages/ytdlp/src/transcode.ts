import { resolve } from "node:path";
import { YtDlpError } from "./errors.ts";
import {
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_STDERR_TAIL_LINES,
  runProcess,
  stoppedError,
} from "./process.ts";

/**
 * ffmpeg into fragmented-MP4 HLS (`index.m3u8`, `init.mp4`, `seg-00001.m4s`…), the compatible
 * copy a browser that cannot play the original is given (the server's docs/transcoding.md).
 */

/** `encode` re-encodes the video to H.264; `remux` copies it (it already is H.264); `audio` has none. */
export type HlsMode = "encode" | "remux" | "audio";
export type HlsEncoder = "libx264" | "nvenc";

export interface HlsPlan {
  /** The source file (made absolute, so it can never read as an option). */
  input: string;
  mode: HlsMode;
  encoder: HlsEncoder;
  /** Keep the audio stream as it is (it is AAC already); else AAC 160 kb/s stereo. */
  copyAudio: boolean;
  /** Tone-map an HDR source to BT.709 before scaling. */
  hdr: boolean;
  segmentSeconds: number;
}

const TONEMAP =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,";
const SCALE = "scale=-2:'min(1080,ih)',format=yuv420p";

const ENCODERS: Record<HlsEncoder, string[]> = {
  libx264: [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-profile:v",
    "high",
    "-sc_threshold",
    "0",
  ],
  nvenc: [
    "-c:v",
    "h264_nvenc",
    "-preset",
    "p4",
    "-rc",
    "vbr",
    "-cq",
    "23",
    "-profile:v",
    "high",
    "-forced-idr",
    "1",
  ],
};

function videoArgs(plan: HlsPlan): string[] {
  switch (plan.mode) {
    case "audio":
      return ["-vn"];
    case "remux":
      return ["-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy"];
    case "encode":
      return [
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        `${plan.hdr ? TONEMAP : ""}${SCALE}`,
        "-force_key_frames",
        `expr:gte(t,n_forced*${String(plan.segmentSeconds)})`,
        ...ENCODERS[plan.encoder],
      ];
  }
}

/** ffmpeg's arguments for `plan`; the outputs are relative to the run's working directory. */
export function hlsArgs(plan: HlsPlan): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    resolve(plan.input),
    ...videoArgs(plan),
    ...(plan.copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "160k", "-ac", "2"]),
    "-progress",
    "pipe:1",
    "-nostats",
    "-f",
    "hls",
    "-hls_time",
    String(plan.segmentSeconds),
    "-hls_playlist_type",
    "event",
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_segment_filename",
    "seg-%05d.m4s",
    "index.m3u8",
  ];
}

export interface TranscodeOptions {
  binary?: string;
  env?: Record<string, string>;
  /** Where ffmpeg writes the playlist, init and segments. */
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  killGraceMs?: number;
  /** Seconds of the source converted so far, from ffmpeg's `-progress` output. */
  onProgress?: (seconds: number) => void;
}

/** `out_time_us=6000000` (or the older, misnamed `out_time_ms`, also microseconds) → 6. */
function progressSeconds(line: string): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  return m === null ? null : Number(m[1]) / 1_000_000;
}

/** Runs ffmpeg for `plan` in `options.cwd`; throws a `YtDlpError` with ffmpeg's last words. */
export async function transcodeHls(plan: HlsPlan, options: TranscodeOptions): Promise<void> {
  let last = -1;
  const result = await runProcess({
    binary: options.binary ?? "ffmpeg",
    args: hlsArgs(plan),
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    killGraceMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
    stderrTailLines: DEFAULT_STDERR_TAIL_LINES,
    onStdoutLine: (line) => {
      const seconds = progressSeconds(line);
      // ffmpeg prints both spellings; report each new time once.
      if (seconds !== null && seconds !== last) {
        last = seconds;
        options.onProgress?.(seconds);
      }
    },
  });
  if (result.stopped !== null) throw stoppedError(result.stopped, result);
  if (result.exitCode !== 0) {
    const message = result.stderrTail.at(-1) ?? `ffmpeg exited with ${String(result.exitCode)}`;
    throw new YtDlpError("unknown", message, {
      exitCode: result.exitCode,
      stderrTail: result.stderrTail,
    });
  }
}
