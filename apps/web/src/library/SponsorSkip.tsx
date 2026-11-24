import type { SkipSegment } from "@uroboros/contract";
import { useCreateTextTrack } from "@videojs/react";
import { useEffect, useMemo, useRef, type RefObject } from "react";

import { notify } from "@/components/ui/sonner";

import { skippedTitle, skipSpans, spanAt } from "./sponsorSkip";

/**
 * The SponsorBlock segments a video keeps (a video profile marks them rather than cutting them,
 * docs/automation.md#sponsorblock): drawn as bands on the timeline (a metadata track labelled
 * "skip", which the patched skin's time slider draws), and jumped over as playback reaches them,
 * with a toast whose Undo goes back and plays that one through. Seeking in by hand while paused
 * skips nothing until it plays.
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
  /** The spans (by start) the viewer chose to watch: never skipped again in this view. */
  const undone = useRef(new Set<number>());
  useEffect(() => {
    const v = video.current;
    if (v === null || spans.length === 0) return;
    const onTime = () => {
      if (v.paused || v.seeking) return;
      const span = spanAt(spans, v.currentTime, undone.current);
      if (span === undefined) return;
      v.currentTime = Number.isFinite(v.duration) ? Math.min(span.end, v.duration) : span.end;
      notify.info(skippedTitle(span), {
        action: {
          label: "Undo",
          onClick: () => {
            undone.current.add(span.start);
            v.currentTime = span.start;
          },
        },
      });
    };
    v.addEventListener("timeupdate", onTime);
    return () => {
      v.removeEventListener("timeupdate", onTime);
    };
  }, [video, spans]);
  return null;
}
