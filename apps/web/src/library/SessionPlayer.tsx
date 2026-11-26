import type { PlaybackRequest, PlaybackSession } from "@uroboros/contract";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from "react";

import { errorText } from "@/api/client";
import { startSession, stopSession, useSession } from "@/api/playback";
import { Button } from "@/components/ui/button";

import type { PlayerProps } from "./Player";

const Player = lazy(() => import("./Player").then((m) => ({ default: m.Player })));

const frame = "grid aspect-video w-full place-items-center bg-raised p-6 md:rounded-[0.75rem]";
/** A lost or failed session is started again by itself at most this often. */
const AUTO_RESTART_EVERY_MS = 30_000;

function Waiting({ text }: { text: string }) {
  return (
    <div className={frame} aria-busy="true">
      <p className="text-muted-foreground">{text}</p>
    </div>
  );
}

type Stage = "starting" | "queued" | "playing";

/** What to show for a session: a playing session, or one handed to another replica after it played, plays on. */
function stageOf(s: PlaybackSession | null, played: boolean): Stage {
  if (s === null) return "starting";
  if (s.state === "running") return "playing";
  if (played && (s.state === "queued" || s.state === "starting")) return "playing";
  return s.state === "queued" ? "queued" : "starting";
}

/** Why the session can't play, if it can't: a problem here, or the session's own failure. */
function failureOf(problem: string | null, s: PlaybackSession | null): string | null {
  if (problem !== null) return problem;
  return s?.state === "failed" ? (s.error ?? "it failed") : null;
}

export interface SessionPlayerProps extends Omit<PlayerProps, "src" | "hls" | "start" | "onError"> {
  /** The item's `playbackUrl`. */
  playbackUrl: string;
  /** What to ask for; `start` is where the first run begins (and the player starts). */
  request: PlaybackRequest;
  /** Plays HLS natively (Safari, iOS) rather than through hls.js. */
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
  /** When the last automatic restart was (they are spaced, never one per page). */
  const [lastAuto, setLastAuto] = useState<number | null>(null);
  /** The session has played: a handover to another replica keeps the player mounted. */
  const [played, setPlayed] = useState(false);
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
  /** A new session at the current position. */
  const restart = useCallback(
    (auto: boolean) => {
      if (auto) setLastAuto(Date.now());
      setPlayed(false);
      setCreated(null);
      setProblem(null);
      setAsk((a) => ({ ...a, start: position() }));
      setAttempt((n) => n + 1);
    },
    [position],
  );
  const mayRestart = () => lastAuto === null || Date.now() - lastAuto > AUTO_RESTART_EVERY_MS;
  /** The session went away (stopped while the tab slept) or failed: a new one, now and then. */
  const onGone = (why: "ended" | "failed") => {
    if (mayRestart()) restart(true);
    else if (why === "ended") setProblem("the playback session ended");
  };
  const state = useSession(created?.url ?? null, onGone);
  const session = state.data ?? created;
  useEffect(() => {
    onSession?.(session);
  }, [session, onSession]);
  const failure = failureOf(problem, session);
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
  const stage = stageOf(session, played);
  if (stage === "queued") return <Waiting text="Waiting for a free transcoder…" />;
  if (stage === "starting" || session === null) return <Waiting text="Starting…" />;
  return (
    <Suspense fallback={<div className={frame} />}>
      <Player
        {...player}
        src={session.masterUrl}
        hls={{ native }}
        start={ask.start}
        onTime={(at, duration) => {
          if (!played) setPlayed(true);
          player.onTime(at, duration);
        }}
        onError={() => {
          if (mayRestart()) restart(true);
          else setProblem("the player could not play it");
        }}
      />
    </Suspense>
  );
}
