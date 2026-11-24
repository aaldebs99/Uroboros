import type { PlaybackFacts } from "@uroboros/contract";
import { rungsFor } from "./ladder.ts";

/** A rendition's columns a player's choice needs (docs/transcoding.md). */
export interface RenditionPlayback {
  video_codecs: string | null;
  audio_codecs: string | null;
  width: number | null;
  height: number | null;
}

/** The item's playback facts: codec strings, size, and the rungs it offers. */
export function playbackFacts(r: RenditionPlayback): PlaybackFacts {
  return {
    videoCodecs: r.video_codecs,
    audioCodecs: r.audio_codecs,
    width: r.width,
    height: r.height,
    qualities:
      r.width === null || r.height === null
        ? []
        : (rungsFor(r.width, r.height).map(String) as PlaybackFacts["qualities"]),
  };
}
