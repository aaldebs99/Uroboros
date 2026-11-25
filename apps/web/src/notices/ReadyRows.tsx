import type { ReadyPreview } from "@uroboros/contract";
import { ListChecks } from "lucide-react";

import { readyDetail } from "@/downloads/readyPreviews";

import { PanelLink } from "./PanelLink";
import { glyphCircle, panelRow } from "./styles";

/**
 * The pasted playlists and channels waiting for a pick (docs/downloads.md), newest first: each
 * opens its picker on the Downloads page, with the picks saved so far, and goes once queued or a
 * day after it was ready.
 */
export function ReadyRows({
  ready,
  now,
  onNavigate,
}: {
  ready: readonly ReadyPreview[];
  /** The minute `useWaitingPreviews` last read, for the time left. */
  now: number;
  onNavigate: () => void;
}) {
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
                {readyDetail(p, now)}
              </span>
            </span>
          </PanelLink>
        </li>
      ))}
    </ul>
  );
}
