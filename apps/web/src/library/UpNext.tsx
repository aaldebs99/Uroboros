import type { LibraryEntry } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";

import { useLibraryPages } from "@/api/library";
import { playlistFilters, usePlaylist } from "@/api/playlists";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { VideoThumbnail } from "./VideoTile";

/** What the watch page plays in order: one of the person's playlists (`?list=`). */
export type PlayQueue = { kind: "playlist"; id: string };

/** A queue's videos, its name, and the search that keeps a watch page in it. */
export interface QueueView {
  title: string;
  entries: LibraryEntry[];
  search: Record<string, string>;
  hasMore: boolean;
  loadMore: () => Promise<unknown>;
}

/** The queue's videos in order (loaded a page at a time), or null without a queue. */
export function useQueue(queue: PlayQueue | null): QueueView | null {
  const playlist = usePlaylist(queue?.id ?? null);
  const p = playlist.data;
  const pages = useLibraryPages(p === undefined ? {} : playlistFilters(p), p !== undefined);
  if (queue === null) return null;
  return {
    title: p?.name ?? "Playlist",
    entries: pages.data?.pages.flatMap((page) => page.entries) ?? [],
    search: { list: queue.id },
    hasMore: pages.hasNextPage,
    loadMore: () => pages.fetchNextPage(),
  };
}

/** The video after `currentId` in the queue, loading the next page when it is past the end. */
export async function nextInQueue(q: QueueView, currentId: string): Promise<string | null> {
  const at = q.entries.findIndex((e) => e.id === currentId);
  const next = q.entries[at + 1];
  if (next !== undefined) return next.id;
  if (!q.hasMore) return null;
  const more = (await q.loadMore()) as { data?: { pages: { entries: LibraryEntry[] }[] } };
  const all = more.data?.pages.flatMap((page) => page.entries) ?? [];
  return all[all.findIndex((e) => e.id === currentId) + 1]?.id ?? null;
}

/** The queue beside the player: its videos in order, the playing one marked (the link's own `aria-current`). */
export function UpNext({ queue, currentId }: { queue: QueueView; currentId: string }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-base font-bold">{queue.title}</h2>
      <ol className="grid gap-1">
        {queue.entries.map((e, i) => {
          const current = e.id === currentId;
          return (
            <li key={e.id}>
              <Link
                to="/library/$entryId"
                params={{ entryId: e.id }}
                search={queue.search}
                className={cn(
                  "flex items-center gap-3 rounded-[0.75rem] p-1.5 hover:bg-raised focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none",
                  current && "bg-raised",
                )}
              >
                <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <VideoThumbnail entry={e} className="w-28 shrink-0 rounded-[0.5rem]" />
                <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium">{e.title}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      {queue.hasMore ? (
        <Button variant="secondary" onClick={() => void queue.loadMore()}>
          Show more
        </Button>
      ) : null}
    </section>
  );
}
