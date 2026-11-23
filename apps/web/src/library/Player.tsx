import "@videojs/react/video/neutral-skin.css";

import type { Chapter, SubtitleTrack } from "@uroboros/contract";
import { useCreateTextTrack } from "@videojs/react";
import { NeutralVideoSkin, Video, VideoPlayer } from "@videojs/react/video";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";

export interface PlayerProps {
  src: string;
  title: string;
  /** Where to start, in seconds (the saved position). */
  start: number;
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

/**
 * Video.js 10 (the Neutral video skin, in the app's accent): keyboard and touch controls, a
 * captions menu for the subtitle tracks, chapters on the timeline, resume and seek.
 */
export function Player(p: PlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  /** The source already resumed: a later change to the saved position must not jump back. */
  const resumedFor = useRef<string | null>(null);
  // Resume: at once if the metadata is already in (it can load before React's listeners attach),
  // otherwise when it arrives.
  useEffect(() => {
    const v = video.current;
    if (v === null || p.start <= 0 || resumedFor.current === p.src) return;
    const resume = () => {
      resumedFor.current = p.src;
      v.currentTime = p.start;
    };
    if (v.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resume();
      return;
    }
    v.addEventListener("loadedmetadata", resume, { once: true });
    return () => {
      v.removeEventListener("loadedmetadata", resume);
    };
  }, [p.src, p.start]);
  useEffect(() => {
    if (p.seek !== null && video.current !== null) {
      video.current.currentTime = p.seek.time;
      void video.current.play().catch(() => undefined);
    }
  }, [p.seek]);
  const at = (v: HTMLVideoElement) =>
    [v.currentTime, Number.isFinite(v.duration) ? v.duration : 0] as const;
  return (
    <VideoPlayer>
      {p.chapters.length > 0 ? <ChapterTrack chapters={p.chapters} /> : null}
      <NeutralVideoSkin style={brand} className="overflow-hidden rounded-[12px] bg-black">
        <Video
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
        </Video>
      </NeutralVideoSkin>
    </VideoPlayer>
  );
}
