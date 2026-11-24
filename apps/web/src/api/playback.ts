import { PlaybackSession, type PlaybackRequest } from "@uroboros/contract";
import { useQuery } from "@tanstack/react-query";

import { ApiError, deleteJson, getJson, postJson } from "./client";

/** A session's state, by its URL. */
export const sessionKey = (url: string) => ["api", "playback", url] as const;

/** How often to look while a session waits or starts, and to keep a running one alive. */
const STARTING_POLL_MS = 1000;
const ALIVE_PING_MS = 20_000;

/** Starts a playback session at an item's `playbackUrl` (docs/transcoding.md). */
export const startSession = (playbackUrl: string, request: PlaybackRequest) =>
  postJson(playbackUrl, PlaybackSession, request);

/**
 * A session's state: polled until it runs, then pinged so the server keeps it, in the background
 * too (a paused video in another tab still holds its place). `onGone` hears when it is gone or
 * was stopped (it idled out while the tab slept, say), or failed.
 */
export function useSession(url: string | null, onGone?: (why: "ended" | "failed") => void) {
  return useQuery({
    queryKey: sessionKey(url ?? ""),
    enabled: url !== null,
    queryFn: async ({ signal }) => {
      try {
        const s = await getJson(url ?? "", PlaybackSession, { signal });
        if (s.state === "stopped") onGone?.("ended");
        if (s.state === "failed") onGone?.("failed");
        return s;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) onGone?.("ended");
        throw err;
      }
    },
    retry: false,
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "queued" || state === "starting") return STARTING_POLL_MS;
      return state === "running" ? ALIVE_PING_MS : false;
    },
  });
}

/**
 * Stops a session; `keepalive` lets it out as the page goes away (a beacon can't carry the CSRF
 * header). Failures don't matter: an abandoned session stops itself within a minute.
 */
export function stopSession(url: string): void {
  void deleteJson(url, { keepalive: true }).catch(() => undefined);
}
