import type { LibraryItem, PlaybackSession } from "@uroboros/contract";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { useItem } from "@/api/library";
import { startSession, stopSession, useSession } from "@/api/playback";

import { PreviewFrame } from "./PreviewFrame";
import { previewSources } from "./previewSource";
import { canPlayOriginal, capabilities, hasNativeHls } from "./playable";

const PreviewHls = lazy(() => import("./PreviewHls"));

interface Ending {
  /** Every source failed, or the video ended: the thumbnail comes back. */
  onEnded: () => void;
}

/**
 * A live 480p session for a preview nothing else can play (docs/transcoding.md): asked for when
 * the preview starts, stopped the moment it does, and played once it runs.
 */
function PreviewSession({
  item,
  onFailed,
  onEnded,
}: Ending & { item: LibraryItem; onFailed: () => void }) {
  const [created, setCreated] = useState<PlaybackSession | null>(null);
  useEffect(() => {
    let live = true;
    let url: string | null = null;
    startSession(item.playbackUrl, {
      quality: "480",
      start: 0,
      copyVideo: false,
      copyAudio: capabilities(item).copyAudio,
    })
      .then((s) => {
        url = s.url;
        if (live) setCreated(s);
        else stopSession(s.url);
      })
      .catch(() => {
        if (live) onFailed();
      });
    return () => {
      live = false;
      if (url !== null) stopSession(url);
    };
  }, [item, onFailed]);
  useEffect(() => {
    if (created === null) return;
    const leave = () => {
      stopSession(created.url);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
    };
  }, [created]);
  // A session that stops or fails gives way, like a file that fails.
  const state = useSession(created?.url ?? null, onFailed);
  const session = state.data ?? created;
  if (session?.state !== "running") return null;
  return (
    <Suspense fallback={null}>
      <PreviewHls
        src={session.masterUrl}
        native={hasNativeHls()}
        subtitles={item.subtitles}
        onFailed={onFailed}
        onEnded={onEnded}
      />
    </Suspense>
  );
}

/** The best source that hasn't failed here: the stored preview, the original, a live session. */
function PreviewOf({ item, onEnded }: Ending & { item: LibraryItem }) {
  const sources = useMemo(() => previewSources(item, canPlayOriginal(item)), [item]);
  const [at, setAt] = useState(0);
  const next = useCallback(() => {
    setAt((n) => n + 1);
  }, []);
  const source = sources[at];
  if (source === undefined) return null;
  if (source.kind === "session") {
    return <PreviewSession item={item} onFailed={next} onEnded={onEnded} />;
  }
  return (
    <PreviewFrame
      key={source.url}
      src={source.url}
      subtitles={item.subtitles}
      onFailed={next}
      onEnded={onEnded}
    />
  );
}

/**
 * A tile's playing preview (docs/library.md "Hover previews"): the video's details, fetched as it
 * starts (the watch page reuses them), then the whole video at 480p over the thumbnail. Decorative
 * to assistive tech: the watch page is where the video is played.
 */
export function PreviewPlayer({ entryId, onEnded }: Ending & { entryId: string }) {
  const item = useItem(entryId).data;
  return (
    <div data-preview aria-hidden className="pointer-events-none absolute inset-0">
      {item === undefined ? null : <PreviewOf item={item} onEnded={onEnded} />}
    </div>
  );
}
