import "@videojs/react/video/neutral-skin.css";
import "./player.css";

import {
  DEFAULT_SPONSORBLOCK_COLORS,
  SPONSORBLOCK_COLOR_KEYS,
  type Chapter,
  type SponsorBlockColors,
  type SponsorSegment,
  type SubtitleTrack,
} from "@uroboros/contract";
import { useCreateTextTrack } from "@videojs/react";
import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import { NativeHlsVideo } from "@videojs/react/media/native-hls-video";
import { NeutralVideoSkin, Video, VideoPlayer } from "@videojs/react/video";
import { SettingsMenuSlot } from "@videojs/react/video/settings-slot";
import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";

import { readVolume, storeVolume } from "@/lib/playerPrefs";

import { AudioArtwork } from "./AudioArtwork";
import { centerCaptions } from "./captions";
import { HighlightJump } from "./HighlightJump";
import { PlayerErrorWatch } from "./PlayerErrorWatch";
import { PlayerHotkeys } from "./PlayerHotkeys";
import { SponsorSkip } from "./SponsorSkip";
import { useSubtitlePref } from "./subtitlePref";

export interface PlayerProps {
  /** The file, or with `hls` a playback session's multivariant playlist. */
  src: string;
  /** Play `src` as HLS: natively (Safari, iOS) or through hls.js (docs/transcoding.md). */
  hls?: { native: boolean };
  title: string;
  /** Where to start, in seconds (the saved position). */
  start: number;
  /**
   * Start playing as soon as the video can. Browsers allow it after a click in the app (opening a
   * video from the library); on a cold page load they may refuse, and the player then waits for
   * the play button.
   */
  autoPlay: boolean;
  /** A seek request; a new object seeks again even to the same time. */
  seek: { time: number } | null;
  /** Drawn on the timeline; the page also lists them. */
  chapters: Chapter[];
  /** SponsorBlock segments: drawn on the timeline and jumped over as playback reaches them. */
  sponsorSegments?: readonly SponsorSegment[];
  /** SponsorBlock's highlight, in seconds: marked on the timeline, with a Jump to highlight. */
  sponsorHighlight?: number | null;
  /** The colors the timeline draws SponsorBlock's segments and highlight in; SponsorBlock's own by default. */
  sponsorColors?: SponsorBlockColors | undefined;
  subtitles: SubtitleTrack[];
  onTime: (position: number, duration: number) => void;
  onPause: (position: number, duration: number) => void;
  onEnded: (position: number, duration: number) => void;
  /** Shown in the settings menu in place of the skin's Quality submenu (QualityMenu). */
  settings?: ReactNode;
  /** Shown over the picture, in fullscreen too: the Stats panel (PlaybackStats). */
  overlay?: ReactNode;
  /** The player failed (once per error): the page may play the video another way. */
  onError?: () => void;
  /**
   * A file with sound alone (no video stream): its thumbnail stands where the picture would be
   * (AudioArtwork). Undefined for a video.
   */
  audio?: { thumbnailUrl: string | null };
}

/** The design system's tokens on the skin's styling hooks (docs: "Customize skins"). */
const brand = {
  "--media-accent-color": "var(--primary)",
  "--media-accent-text-color": "var(--primary-foreground)",
  "--media-border-radius": "0.75rem",
  // The skin sizes its controls, icons and text from this unit (16 pixels by default); in rem they
  // follow the UI's scale like everything else.
  "--media-scale-unit": "1rem",
  "--media-font-family": "inherit",
  "--media-object-fit": "contain",
  "--media-controls-before-start": "visible",
  aspectRatio: "16 / 9",
  width: "100%",
} as CSSProperties;

/** Stable: a new empty list each render would re-add SponsorSkip's track in a loop. */
const NO_SEGMENTS: readonly SponsorSegment[] = [];

/** The SponsorBlock colors as the variables player.css paints the timeline's marks with. */
function colorVariables(colors: SponsorBlockColors): CSSProperties {
  return Object.fromEntries(SPONSORBLOCK_COLOR_KEYS.map((k) => [`--uro-sb-${k}`, colors[k]]));
}

/** The chapters as a text track: the skin's time slider draws them. */
function ChapterTrack({ chapters }: { chapters: Chapter[] }) {
  // Stable across renders: a new track object each render would re-add the track in a loop.
  const track = useMemo(
    () => ({
      kind: "chapters" as const,
      cues: chapters.map((c, i) => ({
        startTime: c.start,
        ...(c.end === null ? {} : { endTime: c.end }),
        text: c.title ?? `Chapter ${String(i + 1)}`,
      })),
    }),
    [chapters],
  );
  useCreateTextTrack(track);
  return null;
}

/** Plays if the browser lets it; a refusal (autoplay policy) or a missing `play` just waits. */
function tryPlay(v: HTMLVideoElement): void {
  void Promise.resolve()
    .then(() => v.play())
    .catch(() => undefined);
}

/**
 * Video.js 10 (the Neutral video skin, in the app's accent, with a timeline styled after YouTube's
 * in player.css): keyboard and touch controls (PlayerHotkeys adds 5 s arrows and frame steps, and
 * HighlightJump Enter for the highlight), a captions menu for the subtitle tracks, chapters on the
 * timeline, SponsorBlock segments skipped (SponsorSkip), resume, seek, autoplay, and the volume and
 * mute remembered in this browser. Subtitles stay off until the viewer turns them on; then the same
 * language is remembered in this browser too (useSubtitlePref).
 */
export function Player(p: PlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  /** The source already started: a later change to the saved position must not jump back. */
  const startedFor = useRef<string | null>(null);
  /** The source whose failure was reported: the element and the player's state both see one. */
  const failedFor = useRef<string | null>(null);
  const { onError, src } = p;
  const { picked, pickedTrack } = useSubtitlePref(video, p.subtitles);
  const report = useCallback(() => {
    if (failedFor.current === src) return;
    failedFor.current = src;
    onError?.();
  }, [onError, src]);
  // The remembered volume, before anything plays.
  useEffect(() => {
    const v = video.current;
    const saved = readVolume();
    if (v === null || saved === null) return;
    v.volume = saved.volume;
    v.muted = saved.muted;
  }, []);
  // Captions across the middle, whatever side the file pins them to.
  useEffect(() => {
    const v = video.current;
    return v === null ? undefined : centerCaptions(v);
  }, [p.subtitles]);
  // Start once per video: resume at the saved position, then play. At once if the metadata is
  // already in (it can load before React's listeners attach), otherwise when it arrives.
  useEffect(() => {
    const v = video.current;
    if (v === null || startedFor.current === p.src) return;
    const begin = () => {
      startedFor.current = p.src;
      if (p.start > 0) v.currentTime = p.start;
      if (p.autoPlay) tryPlay(v);
    };
    if (v.readyState >= HTMLMediaElement.HAVE_METADATA) {
      begin();
      return;
    }
    v.addEventListener("loadedmetadata", begin, { once: true });
    return () => {
      v.removeEventListener("loadedmetadata", begin);
    };
  }, [p.src, p.start, p.autoPlay]);
  useEffect(() => {
    if (p.seek !== null && video.current !== null) {
      video.current.currentTime = p.seek.time;
      tryPlay(video.current);
    }
  }, [p.seek]);
  const at = (v: HTMLVideoElement) =>
    [v.currentTime, Number.isFinite(v.duration) ? v.duration : 0] as const;
  const jump = useCallback((time: number) => {
    const v = video.current;
    if (v === null) return;
    v.currentTime = time;
    tryPlay(v);
  }, []);
  const colors = p.sponsorColors ?? DEFAULT_SPONSORBLOCK_COLORS;
  const style = useMemo(() => ({ ...brand, ...colorVariables(colors) }), [colors]);
  const segments = p.sponsorSegments ?? NO_SEGMENTS;
  const highlight = p.sponsorHighlight ?? null;
  // The same element and props either way: a file, or an HLS copy.
  const Media = p.hls === undefined ? Video : p.hls.native ? NativeHlsVideo : HlsJsVideo;
  return (
    <VideoPlayer>
      <SettingsMenuSlot.Provider value={p.settings ?? null}>
        {p.chapters.length > 0 ? <ChapterTrack chapters={p.chapters} /> : null}
        {segments.length === 0 && highlight === null ? null : (
          <SponsorSkip video={video} segments={segments} highlight={highlight} />
        )}
        {/* data-own-swipe: a sideways drag over the player is the player's, never the phone's
          navigation drawer (components/useDrawerDrag.ts). */}
        <NeutralVideoSkin
          style={style}
          className="uro-player overflow-hidden rounded-[0.75rem] bg-black"
          data-own-swipe=""
        >
          {p.audio === undefined ? null : <AudioArtwork src={p.audio.thumbnailUrl} />}
          {p.overlay}
          <Media
            ref={video}
            src={p.src}
            // Named for screen readers; a `title` would hang a tooltip over the picture.
            aria-label={p.title}
            playsInline
            preload="metadata"
            onTimeUpdate={(e) => {
              p.onTime(...at(e.currentTarget));
            }}
            onPause={(e) => {
              p.onPause(...at(e.currentTarget));
            }}
            onEnded={(e) => {
              p.onEnded(...at(e.currentTarget));
            }}
            onError={report}
            onVolumeChange={(e) => {
              storeVolume({ volume: e.currentTarget.volume, muted: e.currentTarget.muted });
            }}
          >
            {p.subtitles.map((s, i) => (
              <track
                key={s.id}
                src={s.url}
                kind="subtitles"
                srcLang={s.lang}
                label={s.name ?? `${s.lang}${s.automatic ? " (auto)" : ""}`}
                ref={i === picked ? pickedTrack : undefined}
              />
            ))}
          </Media>
          <PlayerHotkeys video={video} />
          {highlight === null ? null : <HighlightJump video={video} at={highlight} onJump={jump} />}
          <PlayerErrorWatch onError={report} />
        </NeutralVideoSkin>
      </SettingsMenuSlot.Provider>
    </VideoPlayer>
  );
}
