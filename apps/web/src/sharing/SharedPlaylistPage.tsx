import type { LibraryEntry } from "@uroboros/contract";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { Copy, Play, SearchX, Share2 } from "lucide-react";

import { ApiError, errorText } from "@/api/client";
import { saveShared, useSharedDetail, useSharedPages } from "@/api/sharing";
import { usePlaylistAction } from "@/api/playlists";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/components/ui/sonner";

import { tileGrid, VideoThumbnail } from "../library/VideoTile";

/** A video of a shared playlist: it opens on the watch page, playing the playlist in order. */
function SharedTile({ entry, shareId }: { entry: LibraryEntry; shareId: string }) {
  return (
    <li>
      <Link
        to="/library/$entryId"
        params={{ entryId: entry.id }}
        search={{ share: shareId }}
        className="grid gap-3 rounded-[0.75rem] focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none"
      >
        <VideoThumbnail entry={entry} className="md:rounded-[0.75rem]" />
        <span className="grid gap-0.5">
          <span className="line-clamp-2 font-medium md:text-[0.9375rem]/[1.3125rem]">
            {entry.title}
          </span>
          {entry.channel === null ? null : (
            <span className="text-xs text-muted-foreground">{entry.channel}</span>
          )}
        </span>
      </Link>
    </li>
  );
}

function SaveCopy({ shareId }: { shareId: string }) {
  const save = usePlaylistAction(saveShared);
  const navigate = useNavigate();
  return (
    <Button
      variant="secondary"
      disabled={save.isPending}
      onClick={() => {
        save.mutate(shareId, {
          onSuccess: (p) => {
            notify.success(`Saved as your playlist "${p.name}".`);
            void navigate({ to: "/library/playlists/$playlistId", params: { playlistId: p.id } });
          },
          onError: (error) => {
            notify.error(errorText(error));
          },
        });
      }}
    >
      <Copy aria-hidden /> Save as my playlist
    </Button>
  );
}

/**
 * A playlist someone shared with the person: its videos in the owner's order, Play all, and Save
 * as my playlist. A shared video opens its watch page; a share that ended says so.
 */
export function SharedPlaylistPage({ shareId }: { shareId: string }) {
  const detail = useSharedDetail(shareId);
  const pages = useSharedPages(detail.data === undefined ? null : shareId);
  if (detail.isError) {
    if (detail.error instanceof ApiError && detail.error.status === 404) {
      return (
        <EmptyState icon={Share2} title="This is no longer shared with you">
          Whoever shared it stopped, or the link expired.
        </EmptyState>
      );
    }
    return <p className="text-destructive">{errorText(detail.error)}</p>;
  }
  const d = detail.data;
  if (d === undefined) return <div aria-busy="true" className="h-40" />;
  if (d.kind === "entry") return <Navigate to="/library/$entryId" params={{ entryId: d.id }} />;
  const entries = pages.data?.pages.flatMap((p) => p.entries) ?? [];
  const first = entries[0];
  return (
    <section className="grid w-full grid-cols-1 gap-6">
      <PageHeader
        titleOnPhone
        title={d.title}
        description={`Shared by ${d.owner} · ${String(d.count ?? entries.length)} videos`}
        action={
          <div className="flex flex-wrap gap-2">
            {first === undefined ? null : (
              <Button asChild>
                <Link
                  to="/library/$entryId"
                  params={{ entryId: first.id }}
                  search={{ share: shareId }}
                >
                  <Play aria-hidden /> Play all
                </Link>
              </Button>
            )}
            <SaveCopy shareId={shareId} />
          </div>
        }
      />
      {d.description ? <p className="whitespace-pre-wrap text-sm">{d.description}</p> : null}
      {pages.isSuccess && entries.length === 0 ? (
        <EmptyState icon={SearchX} title="Nothing in this playlist." />
      ) : (
        <ul className={tileGrid}>
          {entries.map((e) => (
            <SharedTile key={e.id} entry={e} shareId={shareId} />
          ))}
        </ul>
      )}
      {pages.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={pages.isFetchingNextPage}
            onClick={() => void pages.fetchNextPage()}
          >
            Show more
          </Button>
        </div>
      ) : null}
    </section>
  );
}
