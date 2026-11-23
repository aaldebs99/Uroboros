import type { Playback } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";

import { errorText } from "@/api/client";
import { playbackKey, requestPlayback, usePlayback } from "@/api/library";
import { Button } from "@/components/ui/button";

import type { PlayerProps } from "./Player";

const Player = lazy(() => import("./Player").then((m) => ({ default: m.Player })));

/** Native HLS starts on a growing playlist; MSE (Video.js's engine) waits for the whole copy. */
function playable(p: Playback, native: boolean): boolean {
  if (p.state === "done") return true;
  return native && p.state === "running" && p.readySegments >= 2;
}

const frame = "grid aspect-video w-full place-items-center rounded-[0.75rem] bg-raised p-6";

function Preparing({ progress }: { progress: number }) {
  const percent = Math.round(progress * 100);
  return (
    <div className={frame}>
      <div className="grid w-full max-w-sm gap-3 text-center">
        <p className="font-medium">Preparing a version this browser can play</p>
        <div
          role="progressbar"
          aria-label="Preparing the compatible version"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 overflow-hidden rounded-full bg-background"
        >
          <div
            className="h-full rounded-full bg-linear-to-r from-primary-strong to-primary shadow-[0_0_0.75rem] shadow-primary/60 transition-[width]"
            style={{ width: `${String(percent)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          It is kept, so this video plays at once next time.
        </p>
      </div>
    </div>
  );
}

/**
 * Plays the entry's compatible HLS copy (docs/transcoding.md): asks for it, shows real progress
 * while it is made, then plays it natively (`native`) or through Video.js's MSE engine.
 */
export function CompatiblePlayer({
  entryId,
  native,
  ...player
}: Omit<PlayerProps, "src" | "hls"> & { entryId: string; native: boolean }) {
  const client = useQueryClient();
  const [asked, setAsked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Bumped by "Try again": asks for the copy anew. */
  const [attempt, setAttempt] = useState(0);
  const status = usePlayback(entryId, asked);
  useEffect(() => {
    let live = true;
    requestPlayback(entryId)
      .then((p) => {
        if (!live) return;
        client.setQueryData(playbackKey(entryId), p);
        setAsked(true);
      })
      .catch((err: unknown) => {
        if (live) setProblem(errorText(err));
      });
    return () => {
      live = false;
    };
  }, [client, entryId, attempt]);
  const retry = () => {
    setProblem(null);
    setAttempt((n) => n + 1);
  };
  const p = status.data;
  const failure = problem ?? (p?.state === "failed" ? p.error : null);
  if (failure !== null) {
    return (
      <div className={frame}>
        <div className="grid justify-items-center gap-3 text-center">
          <p className="text-destructive">This video could not be converted: {failure}</p>
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (p === undefined || !playable(p, native)) return <Preparing progress={p?.progress ?? 0} />;
  return (
    <Suspense fallback={<div className={frame} />}>
      <Player {...player} src={p.masterUrl} hls={{ native }} />
    </Suspense>
  );
}
