import type { LibraryEntry } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";
import { Download, Eye, EyeOff, Film, ListPlus, MoreVertical, Trash2 } from "lucide-react";

import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { formatBytes, formatDuration } from "@/downloads/format";

import { PreviewSurface } from "./ThumbnailPreview";

const added = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "added today", "added 3 days ago": days are close enough for a library. */
export function addedAgo(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return `added ${added.format(days, "day")}`;
}

/**
 * A video's 16:9 thumbnail with its duration badge and, once started, the watched bar. With
 * `preview`, it plays the video's hover preview while a mouse rests on it or after a press and hold
 * (`ThumbnailPreview.tsx`); the small rows leave it off, where a hover means picking.
 */
export function VideoThumbnail({
  entry,
  className,
  preview = false,
}: {
  entry: LibraryEntry;
  className?: string;
  preview?: boolean;
}) {
  const watched = entry.progress;
  const fraction =
    watched === null || watched.duration <= 0
      ? null
      : watched.watched
        ? 1
        : Math.min(1, watched.position / watched.duration);
  return (
    <PreviewSurface
      previewUrl={preview ? entry.previewUrl : null}
      className={cn("relative aspect-video overflow-hidden bg-raised", className)}
    >
      {entry.thumbnailUrl === null ? (
        <Film className="absolute inset-0 m-auto size-8 text-muted-foreground" aria-hidden />
      ) : (
        <img src={entry.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
      )}
      {entry.duration === null ? null : (
        <span className="absolute right-1.5 bottom-1.5 rounded-[0.25rem] bg-overlay px-1 py-0.5 text-xs font-medium text-overlay-foreground tabular-nums">
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
    </PreviewSurface>
  );
}

/** A bare tile: the thumbnail, then the avatar, a two-line title, the meta line and ⋮. */
export function EntryTile({
  entry,
  onRemove,
  onToggleWatched,
  onSaveToPlaylist,
}: {
  entry: LibraryEntry;
  onRemove: () => void;
  onToggleWatched: () => void;
  onSaveToPlaylist: () => void;
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
        <VideoThumbnail entry={entry} className="md:rounded-[0.75rem]" preview />
      </Link>
      <div className="flex gap-3">
        <Avatar name={entry.channel} />
        <div className="min-w-0 flex-1">
          <Link
            to="/library/$entryId"
            params={{ entryId: entry.id }}
            className={cn(
              tileTitle,
              "hover:underline focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none",
            )}
          >
            {entry.title}
          </Link>
          {entry.channel === null ? null : entry.channelKey === null ? (
            <p className={tileMeta}>{entry.channel}</p>
          ) : (
            <Link
              to="/library/channels/$channelKey"
              params={{ channelKey: entry.channelKey }}
              className={cn("block hover:text-foreground hover:underline", tileMeta)}
            >
              {entry.channel}
            </Link>
          )}
          <p className={tileMeta}>
            {/* An upload has no profile to show (nor has a download whose profile is gone). */}
            {[entry.profileName, formatBytes(entry.sizeBytes), addedAgo(entry.addedAt)]
              .filter((part) => part !== null)
              .join(" · ")}
          </p>
        </div>
        <ResponsiveMenu
          title={`Actions for ${entry.title}`}
          actions={[
            { label: "Save", icon: Download, href: `/api/library/${entry.id}/file` },
            { label: "Save to playlist", icon: ListPlus, onSelect: onSaveToPlaylist },
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

/**
 * The tile grid: one column edge to edge on phones; from md up auto-filled columns of at least
 * 30rem, half again YouTube's (three across a 1920-pixel window beside the side navigation, two at
 * 1440, four at 2560), 1rem apart, rows 2.5rem apart.
 */
export const tileGrid =
  "grid gap-y-3.5 md:grid-cols-[repeat(auto-fill,minmax(min(30rem,100%),1fr))] md:gap-x-4 md:gap-y-10";

/** A tile's two-line title: YouTube's 16/22 at 500 from md up, the body's 14/20 on phones. */
export const tileTitle = "line-clamp-2 font-medium md:text-base/[1.375rem]";

/** A tile's channel and meta lines: muted, 14 from md up (YouTube's), 12 on phones. */
export const tileMeta = "text-xs text-muted-foreground md:text-sm";
