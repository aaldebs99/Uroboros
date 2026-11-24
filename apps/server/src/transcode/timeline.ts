/**
 * A session's segment boundaries (docs/transcoding.md): known in full before anything is made,
 * so its playlist lists the whole video from the first request and any segment can be made on
 * its own. A boundary list holds each segment's start time and, last, the end of the video.
 */

export const SEGMENT_SECONDS = 6;

/** A last segment shorter than this joins the one before it. */
const SLIVER_SECONDS = 1;
/** A keyframe this close before a mark counts as on it (timestamp rounding). */
const EPSILON = 0.001;

function closeAt(boundaries: number[], duration: number): number[] {
  const last = boundaries.at(-1) ?? 0;
  if (boundaries.length > 1 && duration - last < SLIVER_SECONDS) boundaries.pop();
  boundaries.push(duration);
  return boundaries;
}

/** An encode: every 6 s from 0 (keyframes are forced there). */
export function uniformBoundaries(duration: number, seconds = SEGMENT_SECONDS): number[] {
  const starts: number[] = [];
  for (let t = 0; t < duration; t += seconds) starts.push(t);
  if (starts.length === 0) starts.push(0);
  return closeAt(starts, duration);
}

/**
 * A remux, which can only cut where the source has a keyframe: at the first keyframe at or after
 * each 6 s mark, the next mark counted from that keyframe. A long GOP makes a long segment.
 */
export function keyframeBoundaries(
  keyframes: readonly number[],
  duration: number,
  seconds = SEGMENT_SECONDS,
): number[] {
  const starts = [0];
  let mark = seconds;
  for (const k of keyframes) {
    if (k >= duration) break;
    if (k + EPSILON < mark) continue;
    starts.push(k);
    mark = (Math.floor((k + EPSILON) / seconds) + 1) * seconds;
  }
  return closeAt(starts, duration);
}

/** The index of the segment holding time `t`, clamped to the first and the last. */
export function segmentAt(boundaries: readonly number[], t: number): number {
  const last = boundaries.length - 2;
  let i = 0;
  while (i < last && (boundaries[i + 1] as number) <= t) i++;
  return i;
}
