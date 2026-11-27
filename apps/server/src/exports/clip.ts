import { CLIP_MIN_SECONDS, roundClip, type ClipRange } from "@uroboros/contract";
import { ApiError } from "../api/errors.ts";
import { sanitizeSegment } from "../storage/index.ts";
import type { Span } from "./cuts.ts";

/**
 * Clips (docs/sharing.md#clips): a copy that keeps one range of the file rather than cutting its
 * SponsorBlock segments. Everything in the range stays, so a clip never goes stale and a shared one
 * doesn't change with its owner's settings.
 */

/** How far past the file's end a clip may reach and still end at the end (a frame or so). */
const END_SLACK = 1;

/**
 * The range a clip of a file `duration` long keeps, rounded to milliseconds: one a hair past the
 * end ends at the end; one further out, too short once there, or of a file whose length isn't known
 * is refused.
 */
export function checkClip(range: ClipRange, duration: number | null): ClipRange {
  if (duration === null) {
    throw new ApiError("bad_request", "this file's length isn't known, so it can't be clipped");
  }
  const r = roundClip(range);
  if (r.end > duration + END_SLACK) {
    throw new ApiError("bad_request", "the clip runs past the end of the video");
  }
  const end = Math.min(r.end, duration);
  if (end - r.start < CLIP_MIN_SECONDS) {
    throw new ApiError("bad_request", `a clip is at least ${String(CLIP_MIN_SECONDS)} s long`);
  }
  return { start: r.start, end };
}

/** What a clip cuts: the file before and after its range (none where it starts at 0 or runs to the end). */
export function clipCuts(range: ClipRange, duration: number): Span[] {
  return [
    ...(range.start > 0 ? [{ start: 0, end: range.start }] : []),
    ...(range.end < duration ? [{ start: range.end, end: duration }] : []),
  ];
}

/** `h`, `m`, `s` of a time, rounded to the second. */
function parts(t: number) {
  const s = Math.max(0, Math.round(t));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

const two = (n: number) => String(n).padStart(2, "0");

/** A time as the player shows one: `1:02`, or `1:02:05` from an hour. */
function clock(t: number): string {
  const { h, m, s } = parts(t);
  return h > 0 ? `${String(h)}:${two(m)}:${two(s)}` : `${String(m)}:${two(s)}`;
}

/** A time for a file name, with no colon: `1m02s`, or `1h02m05s` from an hour. */
function fileClock(t: number): string {
  const { h, m, s } = parts(t);
  return h > 0 ? `${String(h)}h${two(m)}m${two(s)}s` : `${String(m)}m${two(s)}s`;
}

/** A clip's range in words: `1:02–1:30`. */
export const clipLabel = (r: ClipRange): string => `${clock(r.start)}–${clock(r.end)}`;

/** A clip's range in a file name: `1m02s–1m30s`. */
export const clipFileLabel = (r: ClipRange): string => `${fileClock(r.start)}–${fileClock(r.end)}`;

/** A copy row's clip, when it is one. */
export function clipOf(row: {
  clip_start: number | null;
  clip_end: number | null;
}): ClipRange | null {
  return row.clip_start === null || row.clip_end === null
    ? null
    : { start: row.clip_start, end: row.clip_end };
}

/** The name a copy saves as: `<title> (clip 1m02s–1m30s).mp4`, or `<title> (no sponsors).mp4`. */
export function copyFilename(row: {
  title: string | null;
  video_id: string;
  format: string;
  clip_start: number | null;
  clip_end: number | null;
}): string {
  const clip = clipOf(row);
  const what = clip === null ? "no sponsors" : `clip ${clipFileLabel(clip)}`;
  return `${sanitizeSegment(row.title ?? row.video_id)} (${what}).${row.format}`;
}

/** A clip's title where it is shown on its own (a share, a link's preview): `Trip (clip 1:02–1:30)`. */
export const clipTitle = (title: string, r: ClipRange): string => `${title} (clip ${clipLabel(r)})`;

/** What the "Ready to save" notice says of a finished copy. */
export function readyBody(title: string, clip: ClipRange | null): string {
  return clip === null
    ? `${title}, without its sponsor segments`
    : `A clip of ${title} (${clipLabel(clip)})`;
}
