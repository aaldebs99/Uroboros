import type { PlaybackRequest, PlaybackSession } from "@uroboros/contract";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from "react";

import { errorText } from "@/api/client";
import { startSession, stopSession, useSession } from "@/api/playback";
import { Button } from "@/components/ui/button";

import type { PlayerProps } from "./Player";

const Player = lazy(() => import("./Player").then((m) => ({ default: m.Player })));

const frame = "grid aspect-video w-full place-items-center rounded-[0.75rem] bg-raised p-6";

function Waiting({ text }: { text: string }) {
  return (
    <div className={frame} aria-busy="true">
      <p className="text-muted-foreground">{text}</p>
    </div>
  );
}

export interface SessionPlayerProps extends Omit<PlayerProps, "src" | "hls" | "start" | "onError"> {
  /** The item's `playbackUrl`. */
  playbackUrl: string;
  /** What to ask for; `start` is where the first run begins (and the player starts). */
  request: PlaybackRequest;
  /** Plays HLS natively (Safari, iOS) rather than through Video.js's engine. */
  native: boolean;
  /** Where the viewer is now, for a session started again mid-way. */
  position: () => number;
  /** The session, as it changes (the status line shows how it plays). */
  onSession?: (s: PlaybackSession | null) => void;
  settings?: ReactNode;
}

/**
 * Plays an item through a playback session (docs/transcoding.md): starts one at the viewer's
 * position, says so while it waits or starts, then plays its playlist. A session that is gone (it
 * stopped while the tab slept) or a player that fails starts a new one at the current position,
 * once; leaving stops it.
 */
export function SessionPlayer({
  playbackUrl,
  request,
  native,
  position,
  onSession,
  ...player
}: SessionPlayerProps) {
  const [ask, setAsk] = useState<PlaybackRequest>(request);
  const [attempt, setAttempt] = useState(0);
  const [created, setCreated] = useState<PlaybackSession | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** Whether the one automatic restart was spent. */
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    let live = true;
    let url: string | null = null;
    startSession(playbackUrl, ask)
      .then((s) => {
        url = s.url;
        if (live) setCreated(s);
        else stopSession(s.url);
      })
      .catch((err: unknown) => {
        if (live) setProblem(errorText(err));
      });
    return () => {
      live = false;
      if (url !== null) stopSession(url);
    };
  }, [playbackUrl, ask, attempt]);
  useEffect(() => {
    const leave = () => {
      if (created !== null) stopSession(created.url);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
    };
  }, [created]);
  /** A new session at the current position: once by itself, again only when asked. */
  const restart = useCallback(
    (auto: boolean) => {
      setRecovered(auto);
      setCreated(null);
      setProblem(null);
      setAsk((a) => ({ ...a, start: position() }));
      setAttempt((n) => n + 1);
    },
    [position],
  );
  /** The session went away (gone, or stopped while the tab slept): a new one, once. */
  const onEnded = () => {
    if (recovered) setProblem("the playback session ended");
    else restart(true);
  };
  const state = useSession(created?.url ?? null, onEnded);
  const session = state.data ?? created;
  useEffect(() => {
    onSession?.(session);
  }, [session, onSession]);
  const failure = problem ?? (session?.state === "failed" ? (session.error ?? "it failed") : null);
  if (failure !== null) {
    return (
      <div className={frame}>
        <div className="grid justify-items-center gap-3 text-center">
          <p className="text-destructive">This video couldn't be played: {failure}</p>
          <Button
            variant="secondary"
            onClick={() => {
              restart(false);
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (session === null || session.state === "queued") {
    return <Waiting text={session === null ? "Starting…" : "Waiting for a free transcoder…"} />;
  }
  if (session.state !== "running") return <Waiting text="Starting…" />;
  return (
    <Suspense fallback={<div className={frame} />}>
      <Player
        {...player}
        src={session.masterUrl}
        hls={{ native }}
        start={ask.start}
        onError={() => {
          if (recovered) setProblem("the player could not play it");
          else restart(true);
        }}
      />
    </Suspense>
  );
}
