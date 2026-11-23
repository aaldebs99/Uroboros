import type { LibraryEntry } from "@uroboros/contract";
import { ArrowDown, ArrowUp, X } from "lucide-react";

import { errorText } from "@/api/client";
import { movePlaylistItem, removeFromPlaylist, usePlaylistAction } from "@/api/playlists";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";

import { VideoThumbnail } from "./VideoTile";

/**
 * A manual playlist's videos as rows to reorder (Move up, Move down) and take out, one change at a
 * time. Buttons, not drags, so nothing here competes with the drawer's swipe.
 */
export function PlaylistEditor({
  playlistId,
  entries,
}: {
  playlistId: string;
  entries: LibraryEntry[];
}) {
  const move = usePlaylistAction(movePlaylistItem);
  const remove = usePlaylistAction(removeFromPlaylist);
  const fail = (error: unknown) => {
    notify.error(errorText(error));
  };
  const busy = move.isPending || remove.isPending;
  return (
    <ol className="grid gap-1">
      {entries.map((e, i) => (
        <li key={e.id} className="flex items-center gap-3 rounded-[0.75rem] p-1.5 hover:bg-raised">
          <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
          <VideoThumbnail entry={e} className="w-28 shrink-0 rounded-[0.5rem]" />
          <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium">{e.title}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Move ${e.title} up`}
            disabled={busy || i === 0}
            onClick={() => {
              move.mutate({ id: playlistId, entryId: e.id, position: i - 1 }, { onError: fail });
            }}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Move ${e.title} down`}
            disabled={busy || i === entries.length - 1}
            onClick={() => {
              move.mutate({ id: playlistId, entryId: e.id, position: i + 1 }, { onError: fail });
            }}
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${e.title} from the playlist`}
            disabled={busy}
            onClick={() => {
              remove.mutate({ id: playlistId, entryId: e.id }, { onError: fail });
            }}
          >
            <X aria-hidden />
          </Button>
        </li>
      ))}
    </ol>
  );
}
