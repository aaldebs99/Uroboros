import type { LibraryEntry } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";
import { Download, Film, Library, MoreVertical, Trash2 } from "lucide-react";

import { errorText } from "@/api/client";
import { useLibrary, useRemoveEntry } from "@/api/library";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { TileSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/sonner";
import { formatBytes, formatDuration } from "@/downloads/format";

const added = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "added today", "added 3 days ago": days are close enough for a library. */
function addedAgo(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return `added ${added.format(days, "day")}`;
}

function Thumbnail({ entry }: { entry: LibraryEntry }) {
  const watched = entry.progress;
  const fraction =
    watched === null || watched.duration <= 0
      ? null
      : watched.watched
        ? 1
        : Math.min(1, watched.position / watched.duration);
  return (
    <div className="relative aspect-video overflow-hidden bg-raised max-md:-mx-4 md:rounded-[12px]">
      {entry.thumbnailUrl === null ? (
        <Film className="absolute inset-0 m-auto size-8 text-muted-foreground" aria-hidden />
      ) : (
        <img src={entry.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
      )}
      {entry.duration === null ? null : (
        <span className="absolute right-1.5 bottom-1.5 rounded-[4px] bg-overlay px-1 py-0.5 text-xs font-medium text-overlay-foreground tabular-nums">
          {formatDuration(entry.duration)}
        </span>
      )}
      {fraction === null ? null : (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-white/35">
          <span
            className="block h-full bg-primary"
            style={{ width: `${String(fraction * 100)}%` }}
          />
        </span>
      )}
    </div>
  );
}

/** A bare tile: the thumbnail, then the avatar, a two-line title, the meta line and ⋮. */
function EntryTile({ entry, onRemove }: { entry: LibraryEntry; onRemove: () => void }) {
  return (
    <li className="grid gap-3 max-md:gap-2.5">
      <Thumbnail entry={entry} />
      <div className="flex gap-3">
        <Avatar name={entry.channel} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-medium md:text-[15px]/[21px]">{entry.title}</p>
          {entry.channel === null ? null : (
            <p className="text-xs text-muted-foreground">{entry.channel}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {entry.profileName} · {formatBytes(entry.sizeBytes)} · {addedAgo(entry.addedAt)}
          </p>
        </div>
        <ResponsiveMenu
          title={`Actions for ${entry.title}`}
          actions={[
            { label: "Save", icon: Download, href: `/api/library/${entry.id}/file` },
            { label: "Remove", icon: Trash2, destructive: true, onSelect: onRemove },
          ]}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 shrink-0"
              aria-label={`Actions for ${entry.title}`}
            >
              <MoreVertical className="size-5" />
            </Button>
          }
        />
      </div>
    </li>
  );
}

const grid =
  "grid gap-y-3.5 md:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] md:gap-x-4 md:gap-y-8";

/** Library: everything the person has downloaded (one shared file per video and profile). */
export function LibraryPage() {
  const library = useLibrary();
  const remove = useRemoveEntry();
  const confirm = useConfirm();
  const onRemove = (entry: LibraryEntry) => {
    confirm.ask({
      title: `Remove "${entry.title}"?`,
      description: "It leaves your library. Others who downloaded it keep their copy.",
      confirmLabel: "Remove",
      destructive: true,
      onConfirm: () => {
        remove.mutate(entry.id, {
          onError: (err) => {
            notify.error(errorText(err));
          },
        });
      },
    });
  };
  const entries = library.data ?? [];
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-6">
      <PageHeader title="Library" description="Everything you have downloaded, in one place." />
      {library.isError ? <p className="text-destructive">{errorText(library.error)}</p> : null}
      {library.isPending ? (
        <div aria-busy="true" aria-label="Loading your library" className={grid}>
          {Array.from({ length: 8 }, (_, i) => (
            <TileSkeleton key={i} />
          ))}
        </div>
      ) : null}
      {library.isSuccess && entries.length === 0 ? (
        <EmptyState
          icon={Library}
          title="Nothing here yet."
          action={
            <Button asChild>
              <Link to="/downloads">
                <Download aria-hidden />
                Go to Downloads
              </Link>
            </Button>
          }
        >
          Videos you download show up here.
        </EmptyState>
      ) : (
        <ul className={grid}>
          {entries.map((e) => (
            <EntryTile
              key={e.id}
              entry={e}
              onRemove={() => {
                onRemove(e);
              }}
            />
          ))}
        </ul>
      )}
      {confirm.dialog}
    </section>
  );
}
