import type { LibraryItem, PlaybackSession, Quality } from "@uroboros/contract";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";

import { PlaybackStats } from "./PlaybackStats";
import { canPlayOriginal, capabilities, hasNativeHls } from "./playable";
import type { PlayerProps } from "./Player";
import { PlayerSettings } from "./PlayerSettings";
import { qualityChoices } from "./quality";
import { SessionPlayer } from "./SessionPlayer";

const Player = lazy(() => import("./Player").then((m) => ({ default: m.Player })));

/**
 * On phones the player runs edge to edge, as the library's thumbnails do: across the page's 1rem
 * gutter (both pages that play it have one), its corners only from md up (`Player`,
 * `SessionPlayer`). No full width, which would keep the page's width and only shift it left.
 */
const bleed = "max-md:-mx-4";

/** Where the player will be, while what it plays loads. */
export function PlayerPlaceholder() {
  return (
    <div aria-busy="true" className={`${bleed} aspect-video bg-raised md:rounded-[0.75rem]`} />
  );
}

type Shared = Omit<
  PlayerProps,
  "src" | "hls" | "title" | "chapters" | "sponsorSegments" | "sponsorHighlight" | "subtitles"
>;

/** What the watch player needs of a video: a library item, or a public link's item. */
export type PlayableItem = Pick<
  LibraryItem,
  | "title"
  | "chapters"
  | "sponsorSegments"
  | "sponsorHighlight"
  | "subtitles"
  | "streamUrl"
  | "container"
  | "videoCodec"
  | "videoCodecs"
  | "audioCodecs"
  | "width"
  | "height"
  | "duration"
  | "qualities"
  | "playbackUrl"
  | "thumbnailUrl"
> & {
  /** The file's size, for the Stats panel's bitrate; a public link's item has none. */
  sizeBytes?: number;
};

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
 * the viewer is. The settings menu's Stats row shows a panel over the picture that says how it
 * plays (PlaybackStats).
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
  const [stats, setStats] = useState(false);
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
  const settings = (
    <PlayerSettings
      quality={
        item.qualities.length === 0
          ? null
          : {
              value: choice.quality,
              options: qualityChoices(item.qualities),
              onChange: (q) => {
                setChoice((c) => ({ ...c, quality: q as Quality, start: position.current }));
              },
            }
      }
      stats={stats}
      onStats={() => {
        setStats((on) => !on);
      }}
    />
  );
  const overlay = stats ? (
    <PlaybackStats
      item={item}
      session={viaSession ? session : null}
      onClose={() => {
        setStats(false);
      }}
    />
  ) : undefined;
  const props = {
    ...shared,
    onTime: track,
    title: item.title,
    chapters: item.chapters,
    sponsorSegments: item.sponsorSegments,
    sponsorHighlight: item.sponsorHighlight,
    subtitles: item.subtitles,
    settings,
    overlay,
    // A file with sound alone shows its thumbnail where the picture would be.
    ...(item.videoCodec === null ? { audio: { thumbnailUrl: item.thumbnailUrl } } : {}),
  };
  const player = viaSession ? (
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
    <Suspense fallback={<div className="aspect-video w-full bg-raised md:rounded-[0.75rem]" />}>
      <Player
        {...props}
        src={item.streamUrl}
        start={choice.start}
        onError={() => {
          setChoice((c) => ({ ...c, broken: true, start: position.current }));
        }}
      />
    </Suspense>
  );
  return <div className={bleed}>{player}</div>;
}
