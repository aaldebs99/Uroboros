import type { SkipSegment } from "@uroboros/contract";
import { useCreateTextTrack } from "@videojs/react";
import { useEffect, useMemo, type RefObject } from "react";

import { skippedTitle, skipSpans, spanReached } from "./sponsorSkip";

/**
 * The SponsorBlock segments a video keeps (a video profile marks them rather than cutting them,
 * docs/automation.md#sponsorblock): drawn as bands on the timeline (a metadata track labelled
 * "skip", which the patched skin's time slider draws), and jumped over without a word when playback
 * runs into one. A segment the viewer seeks into plays out, so seeking back to one's start watches
 * it: only playing up to a segment's start skips it.
 */
export function SponsorSkip({
  video,
  segments,
}: {
  video: RefObject<HTMLVideoElement | null>;
  segments: readonly SkipSegment[];
}) {
  const spans = useMemo(() => skipSpans(segments), [segments]);
  // Stable across renders: a new track object each render would re-add the track in a loop.
  const track = useMemo(
    () => ({
      kind: "metadata" as const,
      label: "skip",
      cues: spans.map((s) => ({ startTime: s.start, endTime: s.end, text: skippedTitle(s) })),
    }),
    [spans],
  );
  useCreateTextTrack(track);
  useEffect(() => {
    const v = video.current;
    if (v === null || spans.length === 0) return;
    // Where playback was at the last look; a hair before 0 at the very start, so a segment that
    // starts the video (an intro) is reached when it plays.
    let last = v.currentTime === 0 ? -0.001 : v.currentTime;
    const onSeeked = () => {
      last = v.currentTime;
    };
    const onTime = () => {
      const now = v.currentTime;
      if (v.paused || v.seeking) {
        last = now;
        return;
      }
      const span = spanReached(spans, last, now);
      last = now;
      if (span === undefined) return;
      const end = Number.isFinite(v.duration) ? Math.min(span.end, v.duration) : span.end;
      v.currentTime = end;
      last = end;
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeked", onSeeked);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", onSeeked);
    };
  }, [video, spans]);
  return null;
}
