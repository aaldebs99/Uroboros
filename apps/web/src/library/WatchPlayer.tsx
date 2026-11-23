import type { LibraryItem } from "@uroboros/contract";
import { lazy, Suspense, useMemo, useState } from "react";

import { CompatiblePlayer } from "./CompatiblePlayer";
import { canPlayOriginal, hasNativeHls } from "./playable";
import type { PlayerProps } from "./Player";

const Player = lazy(() => import("./Player").then((m) => ({ default: m.Player })));

type Shared = Omit<PlayerProps, "src" | "hls" | "title" | "chapters" | "subtitles">;

/**
 * The watch page's player: the original file when this browser plays it, else (or when the person
 * asks) the compatible copy, with a switch between the two under it.
 */
export function WatchPlayer({ item, ...shared }: Shared & { item: LibraryItem }) {
  const plays = useMemo(() => canPlayOriginal(item), [item]);
  const native = useMemo(() => hasNativeHls(), []);
  const [compatible, setCompatible] = useState(!plays);
  const props = {
    ...shared,
    title: item.title,
    chapters: item.chapters,
    subtitles: item.subtitles,
  };
  return (
    <div className="grid gap-1.5">
      {compatible ? (
        <CompatiblePlayer {...props} entryId={item.id} native={native} />
      ) : (
        <Suspense fallback={<div className="aspect-video w-full rounded-[12px] bg-raised" />}>
          <Player {...props} src={item.streamUrl} />
        </Suspense>
      )}
      <p className="text-xs text-muted-foreground">
        {compatible ? (
          plays ? (
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setCompatible(false);
              }}
            >
              Play the original
            </button>
          ) : (
            "This browser cannot play the original file, so a compatible version plays."
          )
        ) : (
          <>
            Problems playing?{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setCompatible(true);
              }}
            >
              Use the compatible version
            </button>
          </>
        )}
      </p>
    </div>
  );
}
