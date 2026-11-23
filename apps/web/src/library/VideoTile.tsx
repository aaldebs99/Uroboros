import type { LibraryEntry } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";
import { Download, Eye, EyeOff, Film, MoreVertical, Trash2 } from "lucide-react";

import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { formatBytes, formatDuration } from "@/downloads/format";

const added = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "added today", "added 3 days ago": days are close enough for a library. */
export function addedAgo(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return `added ${added.format(days, "day")}`;
}

/** A video's 16:9 thumbnail with its duration badge and, once started, the watched bar. */
export function VideoThumbnail({ entry, className }: { entry: LibraryEntry; className?: string }) {
  const watched = entry.progress;
  const fraction =
    watched === null || watched.duration <= 0
      ? null
      : watched.watched
        ? 1
        : Math.min(1, watched.position / watched.duration);
  return (
    <div className={cn("relative aspect-video overflow-hidden bg-raised", className)}>
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
        <span aria-hidden data-watched-bar className="absolute inset-x-0 bottom-0 h-1 bg-white/35">
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
export function EntryTile({
  entry,
  onRemove,
  onToggleWatched,
}: {
  entry: LibraryEntry;
  onRemove: () => void;
  onToggleWatched: () => void;
}) {
  const watched = entry.progress?.watched ?? false;
  return (
    <li className="grid gap-3 max-md:gap-2.5">
      {/* The thumbnail opens the video too. The title is the link keyboards and screen readers
          use, so this one stays out of the tab order and the accessibility tree. */}
      <Link
        to="/library/$entryId"
        params={{ entryId: entry.id }}
        tabIndex={-1}
        aria-hidden
        className="block max-md:-mx-4"
      >
        <VideoThumbnail entry={entry} className="md:rounded-[12px]" />
      </Link>
      <div className="flex gap-3">
        <Avatar name={entry.channel} />
        <div className="min-w-0 flex-1">
          <Link
            to="/library/$entryId"
            params={{ entryId: entry.id }}
            className="line-clamp-2 font-medium hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/45 focus-visible:outline-none md:text-[15px]/[21px]"
          >
            {entry.title}
          </Link>
          {entry.channel === null ? null : entry.channelKey === null ? (
            <p className="text-xs text-muted-foreground">{entry.channel}</p>
          ) : (
            <Link
              to="/library/channels/$channelKey"
              params={{ channelKey: entry.channelKey }}
              className="block text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {entry.channel}
            </Link>
          )}
          <p className="text-xs text-muted-foreground">
            {entry.profileName} · {formatBytes(entry.sizeBytes)} · {addedAgo(entry.addedAt)}
          </p>
        </div>
        <ResponsiveMenu
          title={`Actions for ${entry.title}`}
          actions={[
            { label: "Save", icon: Download, href: `/api/library/${entry.id}/file` },
            {
              label: watched ? "Mark unwatched" : "Mark watched",
              icon: watched ? EyeOff : Eye,
              onSelect: onToggleWatched,
            },
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

/** The tile grid: one column edge to edge on phones, auto-filled 16rem columns from md up. */
export const tileGrid =
  "grid gap-y-3.5 md:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] md:gap-x-4 md:gap-y-8";
