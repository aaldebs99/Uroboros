import { usePlayer } from "@videojs/react/video";
import { useEffect, useRef } from "react";

/**
 * Tells the page when the player fails (docs/transcoding.md), once per error: a file the browser
 * said it plays but can't, or a stream whose engine gave up. It reads the player's error state,
 * which also carries the HLS engine's failures (those never reach the <video>'s own events).
 */
export function PlayerErrorWatch({ onError }: { onError: (() => void) | undefined }) {
  const error = usePlayer((s) => s.error);
  const seen = useRef<unknown>(null);
  useEffect(() => {
    if (error === null || error === seen.current) return;
    seen.current = error;
    onError?.();
  }, [error, onError]);
  return null;
}
