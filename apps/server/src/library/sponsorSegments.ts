import {
  SponsorBlockCategory,
  type SponsorBlockSettings,
  type SponsorSegment,
} from "@uroboros/contract";
import { z } from "zod";

/**
 * A file's SponsorBlock segments (docs/automation.md#sponsorblock): a rendition stores every
 * category's (`renditions.skip_segments`), the same for everyone, and each route that hands them
 * out resolves them for one person's setting here.
 */

/** One stored segment: seconds on the file's own timeline, and its category. */
export const StoredSegment = z.object({
  start: z.number(),
  end: z.number(),
  category: SponsorBlockCategory,
});
export type StoredSegment = z.infer<typeof StoredSegment>;
export const StoredSegments = z.array(StoredSegment);

/** The stored segments, or none when the column holds something else. */
export function storedSegments(stored: unknown): StoredSegment[] {
  const parsed = StoredSegments.safeParse(stored);
  return parsed.success ? parsed.data : [];
}

/**
 * The segments `settings` shows or skips, in stored order, each saying which: an audio file (one
 * with no video stream) by the audio choice, anything else by the video one. A segment neither
 * shown nor skipped is left out.
 */
export function sponsorSegmentsFor(
  stored: unknown,
  settings: SponsorBlockSettings,
  audio: boolean,
): SponsorSegment[] {
  const choice = audio ? settings.audio : settings.video;
  const show = new Set<string>(choice.show);
  const skip = new Set<string>(choice.skip);
  return storedSegments(stored).flatMap((s) => {
    const shown = show.has(s.category);
    const skipped = skip.has(s.category);
    return shown || skipped ? [{ ...s, show: shown, skip: skipped }] : [];
  });
}

/** The segments `settings` skips: what a copy without sponsors cuts. */
export function skippedSegments(
  stored: unknown,
  settings: SponsorBlockSettings,
  audio: boolean,
): StoredSegment[] {
  return sponsorSegmentsFor(stored, settings, audio)
    .filter((s) => s.skip)
    .map(({ start, end, category }) => ({ start, end, category }));
}
