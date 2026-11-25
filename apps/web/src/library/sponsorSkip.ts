import type { SponsorBlockCategory, SponsorSegment } from "@uroboros/contract";

/** Segments this close together are one jump: SponsorBlock's overlap and back-to-back entries. */
const JOIN_GAP = 0.5;
/** Inside a segment's last moment, playing on is quicker than a seek. */
const TAIL = 0.2;
/**
 * The most playback moves between two `timeupdate`s (about 4 a second, faster at 2×). A bigger
 * jump, or one backwards, is a seek, never playback reaching a segment.
 */
const MAX_STEP = 2;

/** One stretch the player jumps over: overlapping or touching segments joined. */
export interface SkipSpan {
  start: number;
  end: number;
  categories: SponsorBlockCategory[];
}

/** Joins overlapping and touching segments (within half a second) into spans, in order. */
function joined(segments: readonly SponsorSegment[]): SkipSpan[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const spans: SkipSpan[] = [];
  for (const s of sorted) {
    const last = spans.at(-1);
    if (last !== undefined && s.start <= last.end + JOIN_GAP) {
      last.end = Math.max(last.end, s.end);
      if (!last.categories.includes(s.category)) last.categories.push(s.category);
    } else {
      spans.push({ start: s.start, end: s.end, categories: [s.category] });
    }
  }
  return spans;
}

/** What playback jumps over: the skip segments, joined into spans. */
export function skipSpans(segments: readonly SponsorSegment[]): SkipSpan[] {
  return joined(segments.filter((s) => s.skip));
}

/** One band on the timeline: one category's shown segments joined, and whether playback jumps it. */
export interface ShownSpan {
  start: number;
  end: number;
  category: SponsorBlockCategory;
  skipped: boolean;
}

/**
 * The bands the timeline draws: the shown segments, joined as `skipSpans` joins them but only
 * within one category (so each band has its category's color) and never a band playback jumps
 * with one it plays through, so each reads as what it is. Bands of two categories may overlap.
 */
export function shownSpans(segments: readonly SponsorSegment[]): ShownSpan[] {
  const shown = segments.filter((s) => s.show);
  const bands: ShownSpan[] = [];
  for (const category of new Set(shown.map((s) => s.category))) {
    for (const skipped of [true, false]) {
      const same = shown.filter((s) => s.category === category && s.skip === skipped);
      for (const { start, end } of joined(same)) bands.push({ start, end, category, skipped });
    }
  }
  return bands.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * The span playback ran into between two moments, `from` then `to`, to jump past: one whose start
 * lies between them (short of its last moment). Only playback reaches a span: from a seek into one
 * (`from` already inside it, or at its start) it plays out.
 */
export function spanReached(
  spans: readonly SkipSpan[],
  from: number,
  to: number,
): SkipSpan | undefined {
  const step = to - from;
  if (step < 0 || step > MAX_STEP) return undefined;
  return spans.find((s) => from < s.start && s.start <= to && to < s.end - TAIL);
}

const LABELS: Record<SponsorBlockCategory, string> = {
  sponsor: "sponsor",
  intro: "intro",
  outro: "outro",
  selfpromo: "self-promotion",
  preview: "preview",
  hook: "hook or greeting",
  filler: "filler",
  interaction: "interaction reminder",
  music_offtopic: "non-music section",
};

/** A band's cue on the timeline: "Skipped sponsor" for what playback jumps, "Sponsor" for what it only shows. */
export function bandTitle(span: ShownSpan): string {
  const name = LABELS[span.category];
  return span.skipped ? `Skipped ${name}` : name.charAt(0).toUpperCase() + name.slice(1);
}

/** One cue of the timeline's SponsorBlock track. */
export interface TimelineCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

/** How long the highlight's marker is, as yt-dlp marks a point of interest. */
const POINT = 1;

/**
 * The cues of the timeline's SponsorBlock track (a metadata track labelled "skip", drawn by
 * patches/@videojs__react.patch): each id is `<kind>:<category>:<n>`, the kind `skip` for a band
 * playback jumps, `show` for one it plays through and `point` for the highlight; the markers take
 * their color from the category.
 */
export function timelineCues(
  segments: readonly SponsorSegment[],
  highlight: number | null,
): TimelineCue[] {
  const bands = shownSpans(segments).map((b, i) => ({
    id: `${b.skipped ? "skip" : "show"}:${b.category}:${String(i)}`,
    startTime: b.start,
    endTime: b.end,
    text: bandTitle(b),
  }));
  return highlight === null
    ? bands
    : [
        ...bands,
        {
          id: "point:poi_highlight:0",
          startTime: highlight,
          endTime: highlight + POINT,
          text: "Highlight",
        },
      ];
}
