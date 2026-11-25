import type { ReadyPreview } from "@uroboros/contract";

import { useReadyPreviews } from "@/api/downloads";
import { useNow } from "@/lib/useNow";

/**
 * The person's pasted playlists and channels whose previews wait for a pick (docs/downloads.md),
 * newest first, none past its day: re-read each minute, so one whose day runs out leaves the bell
 * and the Downloads page while the app sits open. `now` is that minute's, for `readyDetail`.
 */
export function useWaitingPreviews(): { ready: readonly ReadyPreview[]; now: number } {
  const waiting = useReadyPreviews();
  const now = useNow(60_000);
  const ready = (waiting.data ?? []).filter((p) => new Date(p.expiresAt).getTime() > now);
  return { ready, now };
}

/** "23h left", or minutes in its last hour. */
function timeLeft(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${String(hours)}h left`;
  return `${String(Math.max(1, Math.floor(ms / 60_000)))}m left`;
}

/** "Playlist · 12 of 30 picked · 23h left". */
export function readyDetail(p: ReadyPreview, now: number): string {
  const kind = p.kind === "channel" ? "Channel" : "Playlist";
  return `${kind} · ${String(p.selected)} of ${String(p.entries)} picked · ${timeLeft(p.expiresAt, now)}`;
}
