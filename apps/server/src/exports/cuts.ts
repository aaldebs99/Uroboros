import type { Chapter, SkipSegment } from "@uroboros/contract";

/**
 * The arithmetic of a copy without SponsorBlock segments (docs/transcoding.md): which spans go,
 * which ranges stay, and where the chapters land. Times are seconds on the file's timeline.
 */

export interface Span {
  start: number;
  end: number;
}

/** Segments this close together go as one, as the player skips them (web `skipSpans`). */
const JOIN_GAP = 0.5;
/** A kept range shorter than this is not worth a join: it goes with its neighbours. */
const MIN_KEPT = 0.25;

const round = (t: number) => Math.round(t * 1000) / 1000;

/** The spans to cut: overlapping and touching segments joined, clipped to the file, in order. */
export function mergeCuts(segments: readonly SkipSegment[], duration: number | null): Span[] {
  const end = duration ?? Number.POSITIVE_INFINITY;
  const sorted = segments
    .map((s) => ({ start: Math.max(0, s.start), end: Math.min(end, s.end) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const spans: Span[] = [];
  for (const s of sorted) {
    const last = spans.at(-1);
    if (last !== undefined && s.start <= last.end + Math.max(JOIN_GAP, MIN_KEPT)) {
      last.end = Math.max(last.end, s.end);
    } else {
      spans.push({ ...s });
    }
  }
  // A sliver at either end of the file goes with the cut beside it.
  const first = spans[0];
  if (first !== undefined && first.start < MIN_KEPT) first.start = 0;
  const last = spans.at(-1);
  if (last !== undefined && duration !== null && duration - last.end < MIN_KEPT) {
    last.end = duration;
  }
  return spans.map((s) => ({ start: round(s.start), end: round(s.end) }));
}

/** What stays: the file between the cuts; the last range's `end` is null (to the file's end). */
export function keptRanges(cuts: readonly Span[]): { start: number; end: number | null }[] {
  const ranges: { start: number; end: number | null }[] = [];
  let at = 0;
  for (const c of cuts) {
    if (c.start > at) ranges.push({ start: at, end: c.start });
    at = c.end;
  }
  ranges.push({ start: at, end: null });
  return ranges;
}

/** The seconds the cuts remove. */
export const cutSeconds = (cuts: readonly Span[]): number =>
  round(cuts.reduce((sum, c) => sum + (c.end - c.start), 0));

/** Where time `t` of the file lands in the copy: earlier cuts close up; a time inside a cut goes to where it was. */
export function mapTime(cuts: readonly Span[], t: number): number {
  let removed = 0;
  for (const c of cuts) {
    if (t <= c.start) break;
    removed += Math.min(t, c.end) - c.start;
  }
  return round(t - removed);
}

/**
 * The chapters on the copy's timeline: each moved as the cuts close up, one left with less than
 * a second dropped (it was cut, or nearly), and each ending where the next begins.
 */
export function remapChapters(
  chapters: readonly Chapter[],
  cuts: readonly Span[],
  duration: number | null,
): { start: number; end: number; title: string }[] {
  const total = duration === null ? null : mapTime(cuts, duration);
  const moved = chapters.flatMap((c, i) => {
    const end = c.end ?? chapters[i + 1]?.start ?? duration;
    if (end === null) return [];
    const s = mapTime(cuts, c.start);
    const e = mapTime(cuts, end);
    return e - s < 1 ? [] : [{ start: s, end: e, title: c.title ?? `Chapter ${String(i + 1)}` }];
  });
  return moved.map((c, i) => ({
    ...c,
    end:
      moved[i + 1]?.start ?? (total === null ? c.end : Math.min(total, Math.max(c.end, c.start))),
  }));
}
