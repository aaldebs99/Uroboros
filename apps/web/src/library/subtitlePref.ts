import type { SubtitleTrack } from "@uroboros/contract";
import { useEffect, useMemo, useRef, type RefObject } from "react";

import { readSubtitleLang, storeSubtitleLang } from "@/lib/playerPrefs";

type Pickable = Pick<SubtitleTrack, "lang" | "automatic">;

/** `en` of `en-US`, `en-orig` or yt-dlp's `en-uYU-mmqFLq8`, in lower case. */
function baseLanguage(lang: string): string {
  return lang.toLowerCase().split("-", 1)[0] ?? "";
}

/**
 * The track to show for a saved language, or `null` for none (subtitles off, or no tracks): the
 * language itself, then any track of its base language, a manual track before an automatic one at
 * each step; failing both, the first manual track, else the first track.
 */
export function pickSubtitle(tracks: readonly Pickable[], lang: string | null): number | null {
  if (lang === null || tracks.length === 0) return null;
  const exact = lang.toLowerCase();
  const base = baseLanguage(lang);
  const tiers: ((t: Pickable) => boolean)[] = [
    (t) => !t.automatic && t.lang.toLowerCase() === exact,
    (t) => t.lang.toLowerCase() === exact,
    (t) => !t.automatic && baseLanguage(t.lang) === base,
    (t) => baseLanguage(t.lang) === base,
    (t) => !t.automatic,
  ];
  for (const matches of tiers) {
    const index = tracks.findIndex(matches);
    if (index !== -1) return index;
  }
  return 0;
}

/** The language of the subtitles or captions track showing, or `null` when none is. */
export function showingLanguage(tracks: Iterable<TextTrack>): string | null {
  for (const track of tracks) {
    if ((track.kind === "subtitles" || track.kind === "captions") && track.mode === "showing") {
      return track.language;
    }
  }
  return null;
}

/**
 * Subtitles off until the viewer turns them on, then the same language on every video, in this
 * browser (lib/playerPrefs). Shows the picked track itself rather than through `default`, which a
 * browser's caption preferences may overrule, and records every change of the media's tracks, so
 * the captions menu, the `c` key and a phone's native fullscreen controls are all remembered. The
 * fallback it shows for a language a video lacks is not recorded, and a video without subtitles
 * leaves the saved choice alone. `pickedTrack` goes on the `<track>` at index `picked`.
 */
export function useSubtitlePref(
  video: RefObject<HTMLVideoElement | null>,
  subtitles: readonly SubtitleTrack[],
): { picked: number | null; pickedTrack: RefObject<HTMLTrackElement | null> } {
  const picked = useMemo(() => pickSubtitle(subtitles, readSubtitleLang()), [subtitles]);
  const pickedTrack = useRef<HTMLTrackElement>(null);
  useEffect(() => {
    const v = video.current;
    if (v === null || subtitles.length === 0) return;
    const shown = picked === null ? null : pickedTrack.current;
    if (shown !== null) shown.track.mode = "showing";
    const setUp = shown === null ? null : shown.track.language;
    const list = v.textTracks;
    let touched = false;
    const onChange = () => {
      const now = showingLanguage(list);
      // The echo of what was just set up, which may be a fallback, is not the viewer's choice.
      if (!touched && now === setUp) return;
      touched = true;
      storeSubtitleLang(now);
    };
    list.addEventListener("change", onChange);
    return () => {
      list.removeEventListener("change", onChange);
    };
  }, [video, subtitles, picked]);
  return { picked, pickedTrack };
}
