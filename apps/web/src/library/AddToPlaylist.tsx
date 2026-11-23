import { ListPlus } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { useItem } from "@/api/library";
import {
  appendToPlaylist,
  removeFromPlaylist,
  usePlaylistAction,
  usePlaylists,
} from "@/api/playlists";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { notify } from "@/components/ui/sonner";

import { PlaylistDialog } from "./PlaylistDialog";

/**
 * Save to playlist: the person's own playlists as checkboxes, ticked where the video is in it;
 * a tick adds it at the end, an untick takes it out. "New playlist" starts one with it.
 */
export function AddToPlaylist({
  entryId,
  title,
  open,
  onOpenChange,
}: {
  entryId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const playlists = usePlaylists();
  const item = useItem(entryId);
  const [creating, setCreating] = useState(false);
  const add = usePlaylistAction(appendToPlaylist);
  const remove = usePlaylistAction(removeFromPlaylist);
  const holding = new Set((item.data?.playlists ?? []).map((p) => p.id));
  const mine = (playlists.data ?? []).filter((p) => p.kind === "manual");
  const fail = (error: unknown) => {
    notify.error(errorText(error));
  };
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Save to playlist</DialogTitle>
          <DialogDescription className="line-clamp-2">{title}</DialogDescription>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have no playlists yet.</p>
          ) : (
            <ul className="grid max-h-80 gap-0.5 overflow-y-auto">
              {mine.map((p) => (
                <li key={p.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[0.625rem] px-2 hover:bg-raised">
                    <Checkbox
                      checked={holding.has(p.id)}
                      disabled={item.isPending || add.isPending || remove.isPending}
                      onChange={(e) => {
                        if (e.target.checked) {
                          add.mutate({ id: p.id, entryIds: [entryId] }, { onError: fail });
                        } else {
                          remove.mutate({ id: p.id, entryId }, { onError: fail });
                        }
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setCreating(true);
              }}
            >
              <ListPlus aria-hidden /> New playlist
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="quiet">
                Done
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PlaylistDialog
        open={creating}
        onOpenChange={setCreating}
        entryIds={[entryId]}
        onSaved={(p) => {
          notify.success(`Saved to "${p.name}".`);
        }}
      />
    </>
  );
}
