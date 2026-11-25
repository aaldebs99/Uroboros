import type { SubtitleTrack } from "@uroboros/contract";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from "react";

import { readSubtitleLang } from "@/lib/playerPrefs";
import { cn } from "@/lib/utils";

import { PreviewControls } from "./PreviewControls";
import { pickPreviewSubtitle } from "./previewSource";
import { previewSound, setPreviewSound } from "./previewSound";

type MediaEvent = (e: SyntheticEvent<HTMLVideoElement>) => void;

/** What a frame hands its media element, a plain <video> or Video.js's HLS one: all of it set. */
export interface PreviewMediaProps {
  ref: Ref<HTMLVideoElement>;
  src: string;
  playsInline: boolean;
  autoPlay: boolean;
  preload: "auto";
  disablePictureInPicture: boolean;
  disableRemotePlayback: boolean;
  tabIndex: number;
  "data-preview-video": string;
  onPlaying: () => void;
  onTimeUpdate: MediaEvent;
  onDurationChange: MediaEvent;
  onProgress: MediaEvent;
  onVolumeChange: MediaEvent;
  onEnded: () => void;
  onError: () => void;
  className: string;
  children: ReactNode;
}

export interface PreviewFrameProps {
  src: string;
  subtitles: readonly SubtitleTrack[];
  /** The source failed to play: the preview tries its next one. */
  onFailed: () => void;
  /** The end: the thumbnail comes back. */
  onEnded: () => void;
  /** Renders the media element; a plain <video> unless given. */
  renderMedia?: (props: PreviewMediaProps) => ReactNode;
}

interface Times {
  at: number;
  duration: number;
  buffered: number;
}

const finite = (n: number) => (Number.isFinite(n) ? n : 0);

function timesOf(v: HTMLVideoElement): Times {
  const ranges = v.buffered;
  return {
    at: v.currentTime,
    duration: finite(v.duration),
    buffered: ranges.length > 0 ? ranges.end(ranges.length - 1) : 0,
  };
}

/**
 * One source playing in a tile (docs/library.md "Hover previews"): the whole video from the start,
 * muted unless previews have sound on, with captions on in the remembered language and the
 * preview's controls once it plays. It wires no progress and never the player's remembered volume
 * or subtitle choice: a preview leaves no trace on the video.
 */
export function PreviewFrame({
  src,
  subtitles,
  onFailed,
  onEnded,
  renderMedia = (props) => <video {...props} />,
}: PreviewFrameProps) {
  const video = useRef<HTMLVideoElement>(null);
  const tracks = useRef<(HTMLTrackElement | null)[]>([]);
  const [shown, setShown] = useState(false);
  const [muted, setMuted] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [times, setTimes] = useState<Times>({ at: 0, duration: 0, buffered: 0 });
  const picked = useMemo(() => pickPreviewSubtitle(subtitles, readSubtitleLang()), [subtitles]);

  // Sound as previews have it; a browser refusing to start with sound gets it muted instead.
  useEffect(() => {
    const v = video.current;
    if (v === null) return;
    v.muted = !previewSound();
    setMuted(v.muted);
    const started = typeof v.play === "function" ? v.play() : undefined;
    started?.catch(() => {
      if (v.muted) return;
      v.muted = true;
      void Promise.resolve(v.play()).catch(() => undefined);
    });
  }, [src]);

  // The picked track shows while captions are on.
  useEffect(() => {
    const el = picked === null ? null : tracks.current[picked];
    if (el == null) return;
    el.track.mode = captions ? "showing" : "disabled";
  }, [picked, captions]);

  const update = (e: SyntheticEvent<HTMLVideoElement>) => {
    setTimes(timesOf(e.currentTarget));
  };
  return (
    <>
      {renderMedia({
        ref: video,
        src,
        playsInline: true,
        autoPlay: true,
        preload: "auto",
        disablePictureInPicture: true,
        disableRemotePlayback: true,
        tabIndex: -1,
        "data-preview-video": "",
        onPlaying: () => {
          setShown(true);
        },
        onTimeUpdate: update,
        onDurationChange: update,
        onProgress: update,
        onVolumeChange: (e) => {
          setMuted(e.currentTarget.muted);
        },
        onEnded,
        onError: onFailed,
        className: cn(
          "absolute inset-0 size-full object-cover transition-opacity duration-150 motion-reduce:transition-none",
          shown ? "opacity-100" : "opacity-0",
        ),
        children: subtitles.map((s, i) => (
          <track
            key={s.id}
            ref={(el) => {
              tracks.current[i] = el;
            }}
            kind="subtitles"
            src={s.url}
            srcLang={s.lang}
            label={s.name ?? `${s.lang}${s.automatic ? " (auto)" : ""}`}
          />
        )),
      })}
      {shown ? (
        <PreviewControls
          muted={muted}
          onSound={() => {
            const v = video.current;
            if (v === null) return;
            v.muted = !v.muted;
            setMuted(v.muted);
            setPreviewSound(!v.muted);
          }}
          captions={picked === null ? undefined : captions}
          onCaptions={() => {
            setCaptions((on) => !on);
          }}
          at={times.at}
          buffered={times.buffered}
          duration={times.duration}
          onSeek={(fraction) => {
            const v = video.current;
            if (v === null || times.duration <= 0) return;
            v.currentTime = fraction * times.duration;
          }}
        />
      ) : null}
    </>
  );
}
