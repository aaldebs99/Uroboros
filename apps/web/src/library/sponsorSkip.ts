import type { SkipSegment, SponsorBlockCategory } from "@uroboros/contract";

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
export function skipSpans(segments: readonly SkipSegment[]): SkipSpan[] {
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
  filler: "filler",
  interaction: "interaction reminder",
  music_offtopic: "non-music section",
};

/** A span's cue on the timeline: "Skipped sponsor", "Skipped sponsor and self-promotion". */
export function skippedTitle(span: SkipSpan): string {
  const names = span.categories.map((c) => LABELS[c]);
  const listed =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
  return `Skipped ${listed}`;
}
