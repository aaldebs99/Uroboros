import { SponsorBlockCategory } from "@uroboros/contract";
import type { SponsorSegment } from "@uroboros/ytdlp";
import type { ProfileArgs } from "../downloads/profiles.ts";
import type { StoredSegment } from "../library/sponsorSegments.ts";

/**
 * The SponsorBlock segments a rendition's player skips: those yt-dlp marked in a video (the
 * profile's categories, SponsorBlock's "skip" action, with a length), in order. An audio file had
 * them cut out (`ytdlpArgsFor`), so it has none to skip.
 */
export function skipSegmentsFor(args: ProfileArgs, segments: SponsorSegment[]): StoredSegment[] {
  if (args.audioOnly) return [];
  const wanted = new Set<string>(args.sponsorblockRemove ?? []);
  return segments
    .flatMap((s) => {
      const category = SponsorBlockCategory.safeParse(s.category);
      const skips = s.type === null || s.type === "skip";
      if (!category.success || !wanted.has(category.data) || !skips || !(s.endTime > s.startTime)) {
        return [];
      }
      return [{ start: s.startTime, end: s.endTime, category: category.data }];
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
}
