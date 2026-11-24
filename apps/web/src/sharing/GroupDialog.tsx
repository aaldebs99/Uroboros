import type { GroupDetail } from "@uroboros/contract";
import { useState, type SubmitEvent } from "react";

import { errorText } from "@/api/client";
import { createGroup, renameGroup, useGroupAction } from "@/api/groups";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { notify } from "@/components/ui/sonner";

/** Makes a group, or renames one (`group` given). `onSaved` gets the group as saved. */
export function GroupDialog({
  open,
  onOpenChange,
  group,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: GroupDetail;
  onSaved?: (g: GroupDetail) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const create = useGroupAction(createGroup);
  const rename = useGroupAction(renameGroup);
  const busy = create.isPending || rename.isPending;
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const done = {
      onSuccess: (g: GroupDetail) => {
        onOpenChange(false);
        if (group === undefined) setName("");
        onSaved?.(g);
      },
      onError: (error: unknown) => {
        notify.error(`Could not save the group: ${errorText(error)}`);
      },
    };
    if (group === undefined) create.mutate(name.trim(), done);
    else rename.mutate({ id: group.id, name: name.trim() }, done);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogTitle>{group === undefined ? "New group" : "Rename group"}</DialogTitle>
        <DialogDescription>
          {group === undefined
            ? "Share videos and playlists with several people at once. You add people next."
            : "Everyone in it sees the new name."}
        </DialogDescription>
        <form className="grid min-w-0 grid-cols-1 gap-3.5" onSubmit={submit}>
          <Field
            label="Name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="quiet">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || name.trim() === ""}>
              {group === undefined ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
