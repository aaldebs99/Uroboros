import { networkInputArgs } from "./ffmpegArgs.ts";
import {
  videoEncoderArgs,
  videoFilter,
  videoInputArgs,
  type EncodeSettings,
} from "./ffmpegVideo.ts";

/**
 * A copy of a stored video without some of it (its SponsorBlock segments), re-encoded so every cut
 * is exact and the sound stays with the picture (docs/transcoding.md "Saving without SponsorBlock
 * segments"): each kept range is trimmed from the decoded frames and samples, the ranges are
 * joined, and the video goes through the pipeline's filters and encoder as a session's does, into
 * an MP4 with the chapters given and progress on stdout.
 */
export interface ExportPlan {
  /** The file's path, or a presigned URL. */
  input: string;
  output: string;
  /** The ranges to keep, in order; a null `end` runs to the end of the file. */
  ranges: readonly { start: number; end: number | null }[];
  /** The video stream's index in the input, and how it is encoded. */
  video: { index: number } & EncodeSettings;
  /** The audio stream's index, when there is one. */
  audio: { index: number } | null;
  vaapiDevice: string;
  /** An ffmetadata file with the copy's chapters, or null for none. */
  chapters: string | null;
  title: string;
}

const t = (s: number) => Math.max(0, s).toFixed(3);

/** `start=…:end=…`, the end left off for the last range. */
const window = (r: { start: number; end: number | null }) =>
  `start=${t(r.start)}${r.end === null ? "" : `:end=${t(r.end)}`}`;

/** The filter graph: trimmed ranges joined, then the pipeline's own filters; outputs [v] and [a]. */
export function exportFilterGraph(p: ExportPlan): string {
  const v = `0:${String(p.video.index)}`;
  const a = p.audio === null ? null : `0:${String(p.audio.index)}`;
  const parts: string[] = [];
  const joined: string[] = [];
  p.ranges.forEach((r, i) => {
    const n = String(i);
    parts.push(`[${v}]trim=${window(r)},setpts=PTS-STARTPTS[v${n}]`);
    joined.push(`[v${n}]`);
    if (a !== null) {
      parts.push(`[${a}]atrim=${window(r)},asetpts=PTS-STARTPTS[a${n}]`);
      joined.push(`[a${n}]`);
    }
  });
  const count = String(p.ranges.length);
  const audio = a === null ? "0" : "1";
  const joinOut = a === null ? "[vj]" : "[vj][a]";
  parts.push(`${joined.join("")}concat=n=${count}:v=1:a=${audio}${joinOut}`);
  parts.push(`[vj]${videoFilter(p.video)}[v]`);
  return parts.join(";");
}

/** The whole command line, after the binary. */
export function exportArgs(p: ExportPlan): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-progress",
    "pipe:1",
    "-nostats",
    ...videoInputArgs(p.video.pipeline, p.vaapiDevice),
    ...networkInputArgs(p.input),
    "-i",
    p.input,
    ...(p.chapters === null ? [] : ["-f", "ffmetadata", "-i", p.chapters]),
    "-filter_complex",
    exportFilterGraph(p),
    "-map",
    "[v]",
    ...(p.audio === null ? [] : ["-map", "[a]"]),
    ...videoEncoderArgs(p.video),
    ...(p.audio === null ? [] : ["-c:a", "aac", "-b:a", "192k"]),
    // The chapters file's metadata (its chapters' titles), never the source's: its chapters are on
    // the uncut timeline, SponsorBlock's among them.
    "-map_metadata",
    p.chapters === null ? "-1" : "1",
    "-map_chapters",
    p.chapters === null ? "-1" : "1",
    "-metadata",
    `title=${p.title}`,
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    "-y",
    p.output,
  ];
}

/** ffmetadata's escapes: `=`, `;`, `#`, `\` and line breaks take a backslash. */
const escape = (text: string) => text.replace(/[=;#\\\n]/g, (c) => `\\${c}`);

/** An ffmetadata file holding `chapters` (seconds), for `ExportPlan.chapters`. */
export function chaptersMetadata(
  chapters: readonly { start: number; end: number; title: string }[],
): string {
  const ms = (s: number) => String(Math.round(s * 1000));
  return [
    ";FFMETADATA1",
    ...chapters.flatMap((c) => [
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${ms(c.start)}`,
      `END=${ms(c.end)}`,
      `title=${escape(c.title)}`,
    ]),
    "",
  ].join("\n");
}

/**
 * The seconds of output an ffmpeg `-progress` block has reached (`out_time_us`, or the misnamed
 * `out_time_ms`, both in microseconds), or null for a line without one.
 */
export function progressSeconds(line: string): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  return m === null ? null : Number(m[1]) / 1_000_000;
}
