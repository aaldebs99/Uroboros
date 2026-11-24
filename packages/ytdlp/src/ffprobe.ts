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
  /**
   * The demuxers ffprobe may use, comma-separated (`-format_whitelist`), for a file someone
   * uploaded: ffmpeg picks a demuxer by content, so a playlist named `.mp4` (HLS, ffconcat) would
   * otherwise make it fetch URLs or read other files. A local file is then held to the file
   * protocol too.
   */
  formats?: string;
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

/** ffprobe writes -99 for a level it doesn't know. */
const level = num.transform((n) => (n === null || n < 0 ? null : n));

const Disposition = z
  .object({ attached_pic: num })
  .nullish()
  .catch(null)
  .transform((d) => ({ attachedPic: d?.attached_pic === 1 }));

export const MediaStream = z
  .object({
    index: z.number(),
    codec_type: str,
    codec_name: str,
    profile: str,
    level,
    mime_codec_string: str,
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
    color_primaries: str,
    disposition: Disposition,
    tags: Tags,
  })
  .transform((s) => ({
    index: s.index,
    /** "video", "audio", "subtitle", "data" or "attachment". */
    type: s.codec_type,
    codec: s.codec_name,
    profile: s.profile,
    /** H.264 ×10, HEVC ×30, AV1 the seq_level_idx; null when unknown. */
    level: s.level,
    /** ffprobe's own RFC 6381 string, when it knows one (not for HEVC). */
    mimeCodec: s.mime_codec_string === "" ? null : s.mime_codec_string,
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
    colorPrimaries: s.color_primaries,
    /** A cover image stored as a video stream (music files): not video to play. */
    attachedPic: s.disposition.attachedPic,
    language: s.tags.language,
  }));
export type MediaStream = z.output<typeof MediaStream>;

export const MediaInfo = z
  .object({
    streams: list(MediaStream),
    format: z.object({
      format_name: str,
      format_long_name: str,
      start_time: numeric,
      duration: numeric,
      size: numeric,
      bit_rate: numeric,
    }),
  })
  .transform((m) => ({
    /** ffprobe's demuxer list, such as "mov,mp4,m4a,3gp,3g2,mj2" or "matroska,webm". */
    container: m.format.format_name,
    containerLongName: m.format.format_long_name,
    /** When the first packet is: some files start a little after 0. */
    startTime: m.format.start_time,
    duration: m.format.duration,
    size: m.format.size,
    bitRate: m.format.bit_rate,
    streams: m.streams,
  }));
export type MediaInfo = z.output<typeof MediaInfo>;

/** Network protocols only, for an input that is a URL (an S3 object). */
const URL_PROTOCOLS = ["-protocol_whitelist", "http,https,tcp,tls,crypto"];

/**
 * The input, with its protocols held to what it needs: a URL to the network ones; a local file,
 * when the demuxers are pinned (`formats`), to the file protocol. An absolute path never starts
 * with "-", so ffmpeg cannot read it as an option; a URL starts with its scheme.
 */
export function inputArgs(path: string, formats?: string): string[] {
  const pinned = formats === undefined ? [] : ["-format_whitelist", formats];
  if (/^https?:\/\//.test(path)) return [...URL_PROTOCOLS, ...pinned, "-i", path];
  const local = formats === undefined ? [] : ["-protocol_whitelist", "file"];
  return [...local, ...pinned, "-i", resolve(path)];
}

/** Reads a media file's (or URL's) container, duration and streams with ffprobe. */
export async function ffprobe(path: string, options: FfprobeOptions = {}): Promise<MediaInfo> {
  const result = await runProcess({
    binary: options.binary ?? "ffprobe",
    args: [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      ...inputArgs(path, options.formats),
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
