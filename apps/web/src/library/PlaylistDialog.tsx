import type { PlaylistDetail } from "@uroboros/contract";
import { useState, type SubmitEvent } from "react";

import { errorText } from "@/api/client";
import { createPlaylist, updatePlaylist, usePlaylistAction } from "@/api/playlists";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, TextareaField } from "@/components/ui/field";
import { notify } from "@/components/ui/sonner";

/**
 * Makes a manual playlist, or renames and describes one (`playlist` given). `onSaved` gets the
 * playlist as saved; `entryIds` start a new one with those videos.
 */
export function PlaylistDialog({
  open,
  onOpenChange,
  playlist,
  entryIds,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist?: PlaylistDetail;
  entryIds?: string[];
  onSaved?: (p: PlaylistDetail) => void;
}) {
  const [name, setName] = useState(playlist?.name ?? "");
  const [description, setDescription] = useState(playlist?.description ?? "");
  const create = usePlaylistAction(createPlaylist);
  const update = usePlaylistAction(updatePlaylist);
  const busy = create.isPending || update.isPending;
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = { name: name.trim(), description: description.trim() || null };
    const done = {
      onSuccess: (p: PlaylistDetail) => {
        onOpenChange(false);
        if (playlist === undefined) setName("");
        onSaved?.(p);
      },
      onError: (error: unknown) => {
        notify.error(`Could not save the playlist: ${errorText(error)}`);
      },
    };
    if (playlist === undefined) {
      create.mutate({ ...values, ...(entryIds === undefined ? {} : { entryIds }) }, done);
    } else {
      update.mutate({ id: playlist.id, patch: values }, done);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{playlist === undefined ? "New playlist" : "Edit playlist"}</DialogTitle>
        <DialogDescription>
          {playlist === undefined
            ? "Videos from your library, in the order you choose."
            : "Its name and what it is about."}
        </DialogDescription>
        <form className="grid gap-3.5" onSubmit={submit}>
          <Field
            label="Name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <TextareaField
            label="Description"
            rows={3}
            maxLength={5000}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="quiet">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || name.trim() === ""}>
              {playlist === undefined ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
