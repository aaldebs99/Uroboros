import { networkInputArgs } from "./ffmpegArgs.ts";
import { videoEncoderArgs, videoFilter, type EncodeSettings } from "./ffmpegVideo.ts";

/**
 * A video's hover preview (docs/library.md "Hover previews"): a short silent clip of snippets from
 * across it (two seconds at the start, at 20%, 40%, 60% and 80%), or the whole of a short video,
 * scaled down and encoded on the CPU into an MP4 that starts playing at once.
 */
export interface PreviewPlan {
  /** The file's path, or a presigned URL. */
  input: string;
  output: string;
  /** The file's length in seconds. */
  duration: number;
  /** The video stream's index in the input, and how it is encoded (the CPU pipeline). */
  video: { index: number } & EncodeSettings;
}

/** Snippets in a preview, and the seconds of each. */
export const PREVIEW_SNIPPETS = 5;
export const SNIPPET_SECONDS = 2;
/** A video shorter than this is its own preview: its snippets would skip under a second apart. */
export const WHOLE_UNDER_SECONDS = 15;

const t = (s: number) => Math.max(0, s).toFixed(3);

/**
 * The windows the preview is made of, in seconds from the file's start (an input-side `-ss` counts
 * from there, past any start time the file has).
 */
export function previewWindows(duration: number): { start: number; length: number }[] {
  if (duration < WHOLE_UNDER_SECONDS) return [{ start: 0, length: WHOLE_UNDER_SECONDS }];
  return Array.from({ length: PREVIEW_SNIPPETS }, (_, k) => ({
    start: (duration * k) / PREVIEW_SNIPPETS,
    length: SNIPPET_SECONDS,
  }));
}

/** The filter graph: each window's frames from 0, joined, then the pipeline's filters; outputs [v]. */
export function previewFilterGraph(p: PreviewPlan): string {
  const count = previewWindows(p.duration).length;
  const parts = Array.from(
    { length: count },
    (_, k) => `[${String(k)}:${String(p.video.index)}]setpts=PTS-STARTPTS[v${String(k)}]`,
  );
  const joined = Array.from({ length: count }, (_, k) => `[v${String(k)}]`).join("");
  parts.push(`${joined}concat=n=${String(count)}:v=1:a=0[vj]`);
  parts.push(`[vj]${videoFilter(p.video)}[v]`);
  return parts.join(";");
}

/**
 * The whole command line, after the binary: one input per window, each seeked before it is opened
 * (so only a little around each point is read and decoded, never the run up to 80%).
 */
export function previewArgs(p: PreviewPlan): string[] {
  const inputs = previewWindows(p.duration).flatMap((w) => [
    "-ss",
    t(w.start),
    "-t",
    t(w.length),
    ...networkInputArgs(p.input),
    "-i",
    p.input,
  ]);
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    ...inputs,
    "-filter_complex",
    previewFilterGraph(p),
    "-map",
    "[v]",
    ...videoEncoderArgs(p.video),
    "-an",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    "-y",
    p.output,
  ];
}
