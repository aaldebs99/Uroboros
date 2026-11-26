import type { SponsorSegment } from "@uroboros/contract";
import { useCreateTextTrack } from "@videojs/react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { SkipNotice, type SkipNoticeContent } from "./SkipNotice";
import { rearmUnskipped, skippedTitle, skipSpans, spanReached, timelineCues } from "./sponsorSkip";

/**
 * The file's SponsorBlock segments as the person's setting has them (Settings › SponsorBlock,
 * docs/automation.md#sponsorblock), and its highlight: the shown segments drawn as bands on the
 * timeline and the highlight as a mark (a metadata track labelled "skip", which the patched skin's
 * time slider draws, each in its category's color; `timelineCues`), and the skipped segments
 * jumped over when playback runs into one, with a notice in the player ("Skipped sponsor",
 * SkipNotice) whose Unskip goes back and plays that one through, skipping it again only after a
 * seek lands 5 s or more before it. A segment the viewer seeks into plays out, so seeking back to
 * one's start watches it too: only playing up to a segment's start skips it. Rendered inside the
 * skin, so the notice sits over the picture.
 */
export function SponsorSkip({
  video,
  segments,
  highlight,
}: {
  video: RefObject<HTMLVideoElement | null>;
  segments: readonly SponsorSegment[];
  highlight: number | null;
}) {
  const spans = useMemo(() => skipSpans(segments), [segments]);
  // Stable across renders: a new track object each render would re-add the track in a loop.
  const track = useMemo(
    () => ({
      kind: "metadata" as const,
      label: "skip",
      cues: timelineCues(segments, highlight),
    }),
    [segments, highlight],
  );
  useCreateTextTrack(track);
  const [notice, setNotice] = useState<SkipNoticeContent | null>(null);
  /** The spans (by start) the viewer unskipped: played through until a seek lands 5 s before. */
  const undone = useRef(new Set<number>());
  const told = useRef(0);
  const dismiss = useCallback(() => {
    setNotice(null);
  }, []);
  useEffect(() => {
    const v = video.current;
    if (v === null || spans.length === 0) return;
    // Where playback was at the last look; a hair before 0 at the very start, so a segment that
    // starts the video (an intro) is reached when it plays.
    let last = v.currentTime === 0 ? -0.001 : v.currentTime;
    const onSeeked = () => {
      last = v.currentTime;
      rearmUnskipped(undone.current, last);
    };
    const onTime = () => {
      const now = v.currentTime;
      if (v.paused || v.seeking) {
        last = now;
        return;
      }
      const span = spanReached(spans, last, now, undone.current);
      last = now;
      if (span === undefined) return;
      const end = Number.isFinite(v.duration) ? Math.min(span.end, v.duration) : span.end;
      v.currentTime = end;
      last = end;
      told.current += 1;
      setNotice({
        id: told.current,
        title: skippedTitle(span),
        unskip: () => {
          undone.current.add(span.start);
          v.currentTime = span.start;
          last = span.start;
        },
      });
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeked", onSeeked);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", onSeeked);
      // An Unskip from before would move playback with stale bookkeeping.
      setNotice(null);
    };
  }, [video, spans]);
  return <SkipNotice notice={notice} onDone={dismiss} />;
}
