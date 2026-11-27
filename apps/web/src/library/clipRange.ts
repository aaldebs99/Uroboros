import { CLIP_MIN_SECONDS, type ClipRange } from "@uroboros/contract";

import { formatDuration } from "@/downloads/format";

/**
 * Clips (docs/sharing.md#clips): a range of a video picked in the player, saved as its own cut file
 * or shared. The arithmetic and words of a range.
 */

/** How long a clip picked afresh runs, from the playhead. */
export const DEFAULT_CLIP_SECONDS = 30;

const clamp = (t: number, lo: number, hi: number) => Math.min(Math.max(t, lo), hi);

/** A fresh clip: 30 s from `at`, shifted back to fit before the end, or a shorter video whole. */
export function defaultRange(at: number, duration: number): ClipRange {
  if (duration <= DEFAULT_CLIP_SECONDS) return { start: 0, end: duration };
  const start = clamp(at, 0, duration - DEFAULT_CLIP_SECONDS);
  return { start, end: start + DEFAULT_CLIP_SECONDS };
}

/** The start moved to `t`: from 0 to a second before the end. */
export const moveStart = (r: ClipRange, t: number, _duration: number): ClipRange => ({
  start: clamp(t, 0, r.end - CLIP_MIN_SECONDS),
  end: r.end,
});

/** The end moved to `t`: from a second after the start to the end of the video. */
export const moveEnd = (r: ClipRange, t: number, duration: number): ClipRange => ({
  start: r.start,
  end: clamp(t, r.start + CLIP_MIN_SECONDS, duration),
});

/**
 * How far a key moves a handle, in seconds: the arrows 1 (10 with Shift), PageUp and PageDown 10,
 * Home and End to the bounds. Null for any other key.
 */
export function keyDelta(key: string, shift: boolean): number | null {
  const step = shift ? 10 : 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return step;
    case "ArrowLeft":
    case "ArrowDown":
      return -step;
    case "PageUp":
      return 10;
    case "PageDown":
      return -10;
    case "Home":
      return Number.NEGATIVE_INFINITY;
    case "End":
      return Number.POSITIVE_INFINITY;
    default:
      return null;
  }
}

/** Where `t` lies along a timeline `duration` long, as a percentage. */
export const percent = (t: number, duration: number): number =>
  duration > 0 ? clamp((t / duration) * 100, 0, 100) : 0;

/** A range in words, as the player shows times: `1:02–1:30`. */
export const clipLabel = (r: ClipRange): string =>
  `${formatDuration(r.start)}–${formatDuration(r.end)}`;

/** A range in a link (the whole video, opened at the clip): `t=62.3&end=90.5`. */
export const rangeQuery = (r: ClipRange): string =>
  `t=${r.start.toFixed(1)}&end=${r.end.toFixed(1)}`;

const seconds = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** The range a link's `t` and `end` give, when both do and it runs at least a second. */
export function rangeOf(search: { t?: unknown; end?: unknown }): ClipRange | null {
  const start = seconds(search.t);
  const end = seconds(search.end);
  if (start === null || end === null || end - start < CLIP_MIN_SECONDS) return null;
  return { start, end };
}
