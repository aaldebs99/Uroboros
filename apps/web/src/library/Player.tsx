import "@videojs/react/video/neutral-skin.css";
import "./player.css";

import type { Chapter, SubtitleTrack } from "@uroboros/contract";
import { useCreateTextTrack } from "@videojs/react";
import { HlsVideo } from "@videojs/react/media/hls-video";
import { NativeHlsVideo } from "@videojs/react/media/native-hls-video";
import { NeutralVideoSkin, Video, VideoPlayer } from "@videojs/react/video";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";

import { readVolume, storeVolume } from "@/lib/playerPrefs";

import { PlayerHotkeys } from "./PlayerHotkeys";

export interface PlayerProps {
  /** The file, or with `hls` a compatible copy's multivariant playlist. */
  src: string;
  /**
   * Play `src` as HLS: natively (Safari, iOS) or through Video.js's MSE engine (docs/transcoding.md).
   */
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
  subtitles: SubtitleTrack[];
  onTime: (position: number, duration: number) => void;
  onPause: (position: number, duration: number) => void;
  onEnded: (position: number, duration: number) => void;
}

/** The design system's tokens on the skin's styling hooks (docs: "Customize skins"). */
const brand = {
  "--media-accent-color": "var(--primary)",
  "--media-accent-text-color": "var(--primary-foreground)",
  "--media-border-radius": "12px",
  "--media-font-family": "inherit",
  "--media-object-fit": "contain",
  "--media-controls-before-start": "visible",
  aspectRatio: "16 / 9",
  width: "100%",
} as CSSProperties;

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
 * in player.css): keyboard and touch controls (PlayerHotkeys adds 5 s arrows and frame steps), a
 * captions menu for the subtitle tracks, chapters on the timeline, resume, seek, autoplay, and
 * the volume and mute remembered in this browser.
 */
export function Player(p: PlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  /** The source already started: a later change to the saved position must not jump back. */
  const startedFor = useRef<string | null>(null);
  // The remembered volume, before anything plays.
  useEffect(() => {
    const v = video.current;
    const saved = readVolume();
    if (v === null || saved === null) return;
    v.volume = saved.volume;
    v.muted = saved.muted;
  }, []);
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
  // The same element and props either way: a file, or an HLS copy.
  const Media = p.hls === undefined ? Video : p.hls.native ? NativeHlsVideo : HlsVideo;
  return (
    <VideoPlayer>
      {p.chapters.length > 0 ? <ChapterTrack chapters={p.chapters} /> : null}
      <NeutralVideoSkin
        style={brand}
        className="uro-player overflow-hidden rounded-[12px] bg-black"
      >
        <Media
          ref={video}
          src={p.src}
          title={p.title}
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
              default={i === 0}
            />
          ))}
        </Media>
        <PlayerHotkeys video={video} />
      </NeutralVideoSkin>
    </VideoPlayer>
  );
}
