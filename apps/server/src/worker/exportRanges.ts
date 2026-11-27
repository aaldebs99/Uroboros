import type { ClipRange } from "@uroboros/contract";
import { clipCuts } from "../exports/clip.ts";
import { cutSeconds, keptRanges, type Span } from "../exports/cuts.ts";

/**
 * What a copy's encode keeps (docs/transcoding.md): the ranges between its cuts, or a clip's one
 * range (docs/sharing.md#clips).
 */
export interface CopyRanges {
  /** The ranges to trim, on the input's clock: the file's own, or from the seek for a clip. */
  ranges: { start: number; end: number | null }[];
  /** Where to seek the input before decoding (a video clip's start), or null. */
  seek: number | null;
  /** The copy's length, for progress; null when the file's isn't known. */
  kept: number | null;
  /** The spans whose removal puts the chapters on the copy's timeline. */
  chapterCuts: Span[];
}

const ms = (t: number) => Math.round(t * 1000) / 1000;

/**
 * The ranges a copy keeps of a file `info` describes. A copy without sponsors keeps what lies
 * between its cuts, shifted by the file's start time. A video clip seeks to its start and trims its
 * length from there; an audio clip trims its range from the start, as a seek in a VBR MP3 lands on
 * an estimate and decoding sound up to it is cheap.
 */
export function rangesOf(
  row: { cuts: Span[]; clip: ClipRange | null },
  info: { duration: number | null; startTime: number | null },
  isVideo: boolean,
): CopyRanges {
  const offset = info.startTime ?? 0;
  const { clip } = row;
  if (clip === null) {
    return {
      ranges: keptRanges(row.cuts).map((r) => ({
        start: r.start + offset,
        end: r.end === null ? null : r.end + offset,
      })),
      seek: null,
      kept: info.duration === null ? null : Math.max(0, info.duration - cutSeconds(row.cuts)),
      chapterCuts: row.cuts,
    };
  }
  const length = ms(clip.end - clip.start);
  return {
    ranges: isVideo
      ? [{ start: 0, end: length }]
      : [{ start: clip.start + offset, end: clip.end + offset }],
    seek: isVideo ? clip.start : null,
    kept: length,
    chapterCuts: clipCuts(clip, info.duration ?? clip.end),
  };
}
