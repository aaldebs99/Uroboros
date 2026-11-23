import { Link } from "@tanstack/react-router";

import { useLibrary } from "@/api/library";
import { Skeleton } from "@/components/ui/skeleton";

import { addedAgo, VideoThumbnail } from "./VideoTile";

/**
 * What to watch next, beside the player: for now the newest videos in the library, without the
 * one playing. Each row is one link: a 10.5rem thumbnail with the title, channel and when it was
 * added beside it. The rows flow into columns once there is room for two (a wide page, or under
 * the details on a narrow one).
 */
export function Suggestions({ currentId }: { currentId: string }) {
  const library = useLibrary();
  if (library.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading suggestions" className="grid gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} aria-hidden className="flex gap-2">
            <Skeleton className="aspect-video w-42 shrink-0 rounded-[0.5rem]" />
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
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-x-4 gap-y-2">
        {list.map((e) => (
          <li key={e.id}>
            <Link
              to="/library/$entryId"
              params={{ entryId: e.id }}
              className="flex gap-2 rounded-[0.625rem] outline-none hover:bg-raised/60 focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45"
            >
              <VideoThumbnail entry={e} className="w-42 shrink-0 rounded-[0.5rem]" />
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
