import type { PlaybackSession } from "@uroboros/contract";
import { X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import {
  bufferAhead,
  framesLine,
  lastSegment,
  networkLine,
  outputLine,
  sourceLine,
  statusText,
  viewportLine,
  type FetchTiming,
  type SourceFacts,
} from "./playbackStats";

/** How often the panel reads the player again. */
const EVERY_MS = 1000;

/** What the panel reads off the player now. */
interface Sample {
  viewport: string | null;
  frames: string | null;
  buffer: string | null;
  network: string | null;
}

const SECONDS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

type Segment = ReturnType<typeof lastSegment>;

/**
 * Hears the session segments the browser fetches (Resource Timing), the newest kept in `into`.
 * An observer rather than `performance.getEntriesByType`, whose buffer stops at 250 entries: a long
 * session fetches more segments than that, and the dev server's modules alone fill it.
 */
function watchSegments(into: { current: Segment }, session: string): () => void {
  if (typeof PerformanceObserver === "undefined") return () => undefined;
  const observer = new PerformanceObserver((list) => {
    into.current =
      lastSegment(list.getEntries() as unknown as FetchTiming[], session) ?? into.current;
  });
  observer.observe({ type: "resource", buffered: true });
  return () => {
    observer.disconnect();
  };
}

/** Reads the player the panel sits in: its size, the picture, the frames and the buffer. */
function sample(player: HTMLElement | null, segment: Segment): Sample {
  const video = player?.querySelector("video") ?? null;
  if (player === null || video === null) {
    return { viewport: null, frames: null, buffer: null, network: null };
  }
  return {
    viewport: viewportLine({
      width: player.clientWidth,
      height: player.clientHeight,
      ratio: window.devicePixelRatio,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    }),
    frames:
      typeof video.getVideoPlaybackQuality === "function"
        ? framesLine(video.getVideoPlaybackQuality())
        : null,
    buffer: `${SECONDS.format(bufferAhead(video.buffered, video.currentTime))} s ahead`,
    network: networkLine(segment),
  };
}

/**
 * The player's Stats panel (docs/transcoding.md), turned on from its settings menu: how the video
 * plays (direct play, a direct stream, or a transcode, on what and why), what its file is, what a
 * session sends, and, read off the player every second, its size on screen, the frames dropped,
 * the buffer ahead and the newest segment's download. It finds its player from where it sits.
 */
export function PlaybackStats({
  item,
  session,
  onClose,
}: {
  item: SourceFacts & { videoCodec: string | null };
  session: PlaybackSession | null;
  onClose: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const segment = useRef<Segment>(null);
  const [now, setNow] = useState<Sample | null>(null);
  // Before the first read, so segments already fetched count; only this session's.
  const sessionUrl = session?.url ?? null;
  useEffect(() => {
    segment.current = null;
    return sessionUrl === null ? undefined : watchSegments(segment, sessionUrl);
  }, [sessionUrl]);
  useEffect(() => {
    const read = () => {
      setNow(sample(root.current?.closest<HTMLElement>(".uro-player") ?? null, segment.current));
    };
    read();
    const timer = setInterval(read, EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const rows: [string, string | null][] = [
    ["Playback", statusText(session, item.videoCodec)],
    ["Source", sourceLine(item)],
    ["Output", outputLine(session)],
    ["Viewport", now?.viewport ?? null],
    ["Frames", now?.frames ?? null],
    ["Buffer", now?.buffer ?? null],
    // Only a session's segments are counted: direct play reads one file by ranges.
    ["Network", session === null ? null : (now?.network ?? null)],
  ];
  return (
    <section
      ref={root}
      aria-label="Playback stats"
      className="absolute top-2 left-2 z-10 max-w-[calc(100%-1rem)] rounded-[0.75rem] bg-overlay py-2 pr-11 pl-3 text-xs text-overlay-foreground tabular-nums"
    >
      <button
        type="button"
        aria-label="Close stats"
        onClick={onClose}
        className="absolute top-0 right-0 grid size-11 place-items-center rounded-[0.75rem] focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none"
      >
        <X className="size-4" aria-hidden />
      </button>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([label, words]) =>
          words === null ? null : (
            <Fragment key={label}>
              <dt className="opacity-70">{label}</dt>
              <dd>{words}</dd>
            </Fragment>
          ),
        )}
      </dl>
    </section>
  );
}
