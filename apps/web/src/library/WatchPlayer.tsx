import type { LibraryItem, PlaybackSession, Quality } from "@uroboros/contract";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";

import { PlaybackStatus } from "./PlaybackStatus";
import { canPlayOriginal, capabilities, hasNativeHls } from "./playable";
import type { PlayerProps } from "./Player";
import { qualityChoices } from "./quality";
import { QualityMenu } from "./QualityMenu";
import { SessionPlayer } from "./SessionPlayer";

const Player = lazy(() => import("./Player").then((m) => ({ default: m.Player })));

type Shared = Omit<
  PlayerProps,
  "src" | "hls" | "title" | "chapters" | "skipSegments" | "subtitles"
>;

/** What the watch player needs of a video: a library item, or a public link's item. */
export type PlayableItem = Pick<
  LibraryItem,
  | "title"
  | "chapters"
  | "skipSegments"
  | "subtitles"
  | "streamUrl"
  | "container"
  | "videoCodec"
  | "videoCodecs"
  | "audioCodecs"
  | "qualities"
  | "playbackUrl"
>;

interface Choice {
  quality: Quality;
  /** The original failed to play here (despite the browser's word): sessions transcode it. */
  broken: boolean;
  /** Where the player (re)starts. */
  start: number;
}

/**
 * The watch page's player (docs/transcoding.md): the original file when this browser plays it,
 * otherwise, or at a quality picked in the player's settings menu, a playback session from where
 * the viewer is; a line under it says how it plays.
 */
export function WatchPlayer({ item, ...shared }: Shared & { item: PlayableItem }) {
  const direct = useMemo(() => canPlayOriginal(item), [item]);
  const caps = useMemo(() => capabilities(item), [item]);
  const native = useMemo(() => hasNativeHls(), []);
  const position = useRef(shared.start);
  const [choice, setChoice] = useState<Choice>({
    quality: "original",
    broken: false,
    start: shared.start,
  });
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const { onTime } = shared;
  const track = useCallback(
    (at: number, duration: number) => {
      position.current = at;
      onTime(at, duration);
    },
    [onTime],
  );
  const where = useCallback(() => position.current, []);
  const viaSession = choice.quality !== "original" || choice.broken || !direct;
  const settings =
    item.qualities.length === 0 ? undefined : (
      <QualityMenu
        value={choice.quality}
        options={qualityChoices(item.qualities)}
        onChange={(q) => {
          setChoice((c) => ({ ...c, quality: q as Quality, start: position.current }));
        }}
      />
    );
  const props = {
    ...shared,
    onTime: track,
    title: item.title,
    chapters: item.chapters,
    skipSegments: item.skipSegments,
    subtitles: item.subtitles,
    settings,
  };
  return (
    <div className="grid gap-1.5">
      {viaSession ? (
        <SessionPlayer
          key={`${choice.quality} ${String(choice.broken)} ${String(choice.start)}`}
          {...props}
          playbackUrl={item.playbackUrl}
          native={native}
          position={where}
          onSession={setSession}
          request={{
            quality: choice.quality,
            start: choice.start,
            copyVideo: caps.copyVideo && !choice.broken,
            copyAudio: caps.copyAudio,
          }}
        />
      ) : (
        <Suspense fallback={<div className="aspect-video w-full rounded-[0.75rem] bg-raised" />}>
          <Player
            {...props}
            src={item.streamUrl}
            start={choice.start}
            onError={() => {
              setChoice((c) => ({ ...c, broken: true, start: position.current }));
            }}
          />
        </Suspense>
      )}
      <PlaybackStatus session={viaSession ? session : null} videoCodec={item.videoCodec} />
    </div>
  );
}
