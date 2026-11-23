import type { LibraryEntry } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { errorText } from "@/api/client";
import { setWatched, useLibraryPages, useRemoveEntry, type LibraryFilters } from "@/api/library";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { TileSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/sonner";

import { AddToPlaylist } from "./AddToPlaylist";
import { EntryTile, tileGrid } from "./VideoTile";

/** Loads the next page when the sentinel scrolls into view (where IntersectionObserver exists). */
function useLoadMore(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!enabled || node === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((items) => {
      if (items.some((i) => i.isIntersecting)) onVisible();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [enabled, onVisible]);
  return ref;
}

/** The library's tiles for `filters`, paged; `empty` shows when nothing matches. */
export function LibraryGrid({ filters, empty }: { filters: LibraryFilters; empty: ReactNode }) {
  const pages = useLibraryPages(filters);
  const client = useQueryClient();
  const remove = useRemoveEntry();
  const confirm = useConfirm();
  const [saving, setSaving] = useState<LibraryEntry | null>(null);
  const more = () => {
    if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage();
  };
  const sentinel = useLoadMore(more, pages.hasNextPage);
  const onRemove = (entry: LibraryEntry) => {
    confirm.ask({
      title: `Remove "${entry.title}"?`,
      description: "It leaves your library. Others who downloaded it keep their copy.",
      confirmLabel: "Remove",
      destructive: true,
      onConfirm: () => {
        remove.mutate(entry.id, {
          onSuccess: () => {
            void client.invalidateQueries({ queryKey: ["api", "library"] });
          },
          onError: (err) => {
            notify.error(errorText(err));
          },
        });
      },
    });
  };
  if (pages.isError) return <p className="text-destructive">{errorText(pages.error)}</p>;
  if (pages.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading your library" className={tileGrid}>
        {Array.from({ length: 8 }, (_, i) => (
          <TileSkeleton key={i} />
        ))}
      </div>
    );
  }
  const entries = pages.data.pages.flatMap((p) => p.entries);
  if (entries.length === 0) return <>{empty}</>;
  return (
    <>
      <ul className={tileGrid}>
        {entries.map((e) => (
          <EntryTile
            key={e.id}
            entry={e}
            onRemove={() => {
              onRemove(e);
            }}
            onSaveToPlaylist={() => {
              setSaving(e);
            }}
            onToggleWatched={() => {
              setWatched(e.id, !(e.progress?.watched ?? false))
                .then(() => client.invalidateQueries({ queryKey: ["api", "library"] }))
                .catch((err: unknown) => {
                  notify.error(errorText(err));
                });
            }}
          />
        ))}
      </ul>
      {pages.hasNextPage ? (
        <div ref={sentinel} className="flex justify-center">
          <Button variant="secondary" disabled={pages.isFetchingNextPage} onClick={more}>
            Show more
          </Button>
        </div>
      ) : null}
      {confirm.dialog}
      {saving === null ? null : (
        <AddToPlaylist
          entryId={saving.id}
          title={saving.title}
          open
          onOpenChange={(open) => {
            if (!open) setSaving(null);
          }}
        />
      )}
    </>
  );
}
