import { resolve } from "node:path";
import { z } from "zod";
import { YtDlpError } from "./errors.ts";
import { list, num, str } from "./lenient.ts";
import {
  checkRun,
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_STDERR_TAIL_LINES,
  runProcess,
} from "./process.ts";

export interface FfprobeOptions {
  /** The ffprobe executable. Defaults to `ffprobe` on PATH. */
  binary?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Readonly<Record<string, string>>;
  killGraceMs?: number;
}

/** ffprobe prints most numbers as strings ("634.566"), so both are accepted. */
const numeric = z
  .union([z.number(), z.string()])
  .nullish()
  .catch(null)
  .transform((v) => {
    const n = typeof v === "string" ? Number(v) : v;
    return n == null || !Number.isFinite(n) ? null : n;
  });

/** A rate such as "30000/1001"; "0/0" (unknown) becomes null. */
function rate(value: string | null): number | null {
  if (value === null) return null;
  const [numerator, denominator] = value.split("/").map(Number);
  if (numerator === undefined || denominator === undefined) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) && result > 0 ? result : null;
}

const Tags = z
  .record(z.string(), z.unknown())
  .nullish()
  .catch(null)
  .transform((tags) => {
    const language = tags?.["language"];
    return { language: typeof language === "string" ? language : null };
  });

export const MediaStream = z
  .object({
    index: z.number(),
    codec_type: str,
    codec_name: str,
    profile: str,
    width: num,
    height: num,
    avg_frame_rate: str,
    r_frame_rate: str,
    sample_rate: numeric,
    channels: num,
    duration: numeric,
    bit_rate: numeric,
    pix_fmt: str,
    color_transfer: str,
    tags: Tags,
  })
  .transform((s) => ({
    index: s.index,
    /** "video", "audio", "subtitle", "data" or "attachment". */
    type: s.codec_type,
    codec: s.codec_name,
    profile: s.profile,
    width: s.width,
    height: s.height,
    fps: rate(s.avg_frame_rate) ?? rate(s.r_frame_rate),
    sampleRate: s.sample_rate,
    channels: s.channels,
    duration: s.duration,
    bitRate: s.bit_rate,
    /** "yuv420p", "yuv420p10le"…: 8-bit or not decides whether H.264 can be copied. */
    pixFmt: s.pix_fmt,
    /** "smpte2084" (PQ) or "arib-std-b67" (HLG) mark an HDR source. */
    colorTransfer: s.color_transfer,
    language: s.tags.language,
  }));
export type MediaStream = z.output<typeof MediaStream>;

export const MediaInfo = z
  .object({
    streams: list(MediaStream),
    format: z.object({
      format_name: str,
      format_long_name: str,
      duration: numeric,
      size: numeric,
      bit_rate: numeric,
    }),
  })
  .transform((m) => ({
    /** ffprobe's demuxer list, such as "mov,mp4,m4a,3gp,3g2,mj2" or "matroska,webm". */
    container: m.format.format_name,
    containerLongName: m.format.format_long_name,
    duration: m.format.duration,
    size: m.format.size,
    bitRate: m.format.bit_rate,
    streams: m.streams,
  }));
export type MediaInfo = z.output<typeof MediaInfo>;

/** Reads a media file's container, duration and streams with ffprobe. */
export async function ffprobe(path: string, options: FfprobeOptions = {}): Promise<MediaInfo> {
  const result = await runProcess({
    binary: options.binary ?? "ffprobe",
    // An absolute path never starts with "-", so ffprobe cannot read it as an option.
    args: [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      "-i",
      resolve(path),
    ],
    env: options.env,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    killGraceMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
    stderrTailLines: DEFAULT_STDERR_TAIL_LINES,
  });
  const stdout = checkRun(result);
  try {
    return MediaInfo.parse(JSON.parse(stdout));
  } catch (cause) {
    throw new YtDlpError("invalid_output", "ffprobe's output is not a media description", {
      cause,
      exitCode: result.exitCode,
      stderrTail: result.stderrTail,
    });
  }
}
