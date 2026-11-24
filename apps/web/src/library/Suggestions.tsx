import { Link } from "@tanstack/react-router";

import { useLibrary } from "@/api/library";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { addedAgo, VideoThumbnail } from "./VideoTile";

/** The thumbnail's share of a row: 40% of it, never under 10.5rem (a phone's column). */
const thumb = "w-[40%] min-w-42 shrink-0 rounded-[0.5rem]";

/**
 * What to watch next, beside the player: for now the newest videos in the library, without the
 * one playing. One per row, each one link across the whole column: the thumbnail grows with it
 * (`thumb`), and the title, channel and when it was added fill the rest beside it.
 */
export function Suggestions({ currentId }: { currentId: string }) {
  const library = useLibrary();
  if (library.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading suggestions" className="grid gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} aria-hidden className="flex gap-2">
            <Skeleton className={cn("aspect-video", thumb)} />
            <div className="grid flex-1 content-start gap-2 pt-1">
              <Skeleton className="h-3 w-[90%]" />
              <Skeleton className="h-3 w-[60%]" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  const list = (library.data ?? []).filter((e) => e.id !== currentId);
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="suggestions-heading" className="grid content-start gap-3">
      <h2 id="suggestions-heading" className="text-base font-bold">
        From your library
      </h2>
      <ul className="grid gap-2">
        {list.map((e) => (
          <li key={e.id}>
            <Link
              to="/library/$entryId"
              params={{ entryId: e.id }}
              className="flex gap-3 rounded-[0.625rem] outline-none hover:bg-raised/60 focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45"
            >
              <VideoThumbnail entry={e} className={thumb} />
              <span className="grid min-w-0 flex-1 content-start gap-1 py-0.5 pr-1">
                <span className="line-clamp-2 text-sm font-medium">{e.title}</span>
                {e.channel === null ? null : (
                  <span className="truncate text-xs text-muted-foreground">{e.channel}</span>
                )}
                <span className="text-xs text-muted-foreground">{addedAgo(e.addedAt)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
