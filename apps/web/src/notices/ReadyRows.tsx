import type { ReadyPreview } from "@uroboros/contract";
import { ListChecks } from "lucide-react";

import { useNow } from "@/lib/useNow";

import { PanelLink } from "./PanelLink";
import { glyphCircle, panelRow } from "./styles";

/** "23h left", or minutes in its last hour. */
function timeLeft(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${String(hours)}h left`;
  return `${String(Math.max(1, Math.floor(ms / 60_000)))}m left`;
}

/**
 * The pasted playlists and channels waiting for a pick (docs/downloads.md), newest first: each
 * opens its picker on the Downloads page, with the picks saved so far, and goes once queued or a
 * day after it was ready.
 */
export function ReadyRows({
  ready,
  onNavigate,
}: {
  ready: readonly ReadyPreview[];
  onNavigate: () => void;
}) {
  const now = useNow(60_000);
  return (
    <ul className="grid">
      {ready.map((p) => (
        <li key={p.id}>
          <PanelLink
            href={`/downloads?request=${encodeURIComponent(p.id)}`}
            onNavigate={onNavigate}
            className={panelRow}
          >
            <span className={glyphCircle}>
              <ListChecks aria-hidden />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="line-clamp-2 font-medium break-words">{p.title ?? p.url}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {p.kind === "channel" ? "Channel" : "Playlist"} · {String(p.selected)} of{" "}
                {String(p.entries)} picked · {timeLeft(p.expiresAt, now)}
              </span>
            </span>
          </PanelLink>
        </li>
      ))}
    </ul>
  );
}
