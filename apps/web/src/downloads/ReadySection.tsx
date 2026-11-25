import type { ReadyPreview } from "@uroboros/contract";
import { ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";

import { readyDetail } from "./readyPreviews";

/**
 * The Downloads page's pasted playlists and channels waiting for a pick, as the bell lists them:
 * Pick opens one in the picker above (the one open there is left out until it closes).
 */
export function ReadySection({
  ready,
  now,
  onPick,
}: {
  ready: readonly ReadyPreview[];
  now: number;
  onPick: (id: string) => void;
}) {
  if (ready.length === 0) return null;
  return (
    <section aria-labelledby="ready-heading" className="grid gap-1">
      <h2 id="ready-heading" className="text-base font-bold">
        Ready to pick
      </h2>
      <ul className="grid">
        {ready.map((p) => {
          const title = p.title ?? p.url;
          return (
            <li
              key={p.id}
              className="flex items-center gap-3 border-t border-border py-3.5 first:border-t-0 md:gap-4"
            >
              <span className="grid aspect-video w-24 shrink-0 place-items-center rounded-[0.5rem] bg-raised md:w-30">
                <ListChecks className="size-5 text-muted-foreground" aria-hidden />
              </span>
              <div className="grid min-w-0 flex-1 grid-cols-1 content-start gap-1.5">
                <p className="truncate font-medium">{title}</p>
                <p className="truncate text-xs text-muted-foreground tabular-nums">
                  {readyDetail(p, now)}
                </p>
              </div>
              <Button
                variant="secondary"
                size="compact"
                aria-label={`Pick from ${title}`}
                onClick={() => {
                  onPick(p.id);
                }}
              >
                Pick
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
