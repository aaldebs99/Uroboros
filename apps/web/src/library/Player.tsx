import type { Chapter, SubtitleTrack } from "@uroboros/contract";
import { useEffect, useRef } from "react";

export interface PlayerProps {
  src: string;
  title: string;
  /** Where to start, in seconds (the saved position). */
  start: number;
  /** A seek request; a new object seeks again even to the same time. */
  seek: { time: number } | null;
  /** Shown as the page's chapter list; the browser's timeline has no markers. */
  chapters: Chapter[];
  subtitles: SubtitleTrack[];
  onTime: (position: number, duration: number) => void;
  onPause: (position: number, duration: number) => void;
  onEnded: (position: number, duration: number) => void;
}

/**
 * The browser's own player: native controls (keyboard, fullscreen, picture-in-picture), subtitles
 * as `<track>`s in its captions menu, and seeks from the page's chapter list.
 */
export function Player(p: PlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (p.seek !== null && video.current !== null) {
      video.current.currentTime = p.seek.time;
      void video.current.play().catch(() => undefined);
    }
  }, [p.seek]);
  const at = (v: HTMLVideoElement) =>
    [v.currentTime, Number.isFinite(v.duration) ? v.duration : 0] as const;
  return (
    <video
      ref={video}
      src={p.src}
      title={p.title}
      controls
      playsInline
      preload="metadata"
      className="aspect-video w-full rounded-[12px] bg-black"
      onLoadedMetadata={(e) => {
        if (p.start > 0) e.currentTarget.currentTime = p.start;
      }}
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
    </video>
  );
}
