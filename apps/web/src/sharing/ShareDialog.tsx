import type { ShareKind } from "@uroboros/contract";
import { Share2 } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { useDirectory, useShareState } from "@/api/sharing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";

import { LinkSection } from "./LinkSection";
import { PeopleSection } from "./PeopleSection";

/**
 * Share a video or a playlist (docs/sharing.md): with people and groups, and by a public link.
 * Every change saves as it is made.
 */
export function ShareDialog({
  kind,
  id,
  title,
  open,
  onOpenChange,
}: {
  kind: ShareKind;
  id: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const state = useShareState(kind, id, open);
  const directory = useDirectory(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto sm:w-[min(32rem,calc(100vw-3rem))]">
        <DialogTitle>Share "{title}"</DialogTitle>
        <DialogDescription>
          People you choose see it under Shared; a link works for anyone.
        </DialogDescription>
        {state.isError ? <p className="text-destructive">{errorText(state.error)}</p> : null}
        {state.data === undefined ? null : (
          <>
            <PeopleSection
              kind={kind}
              id={id}
              people={state.data.people}
              directory={directory.data}
            />
            <LinkSection kind={kind} id={id} link={state.data.link} />
          </>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="quiet">
              Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A Share button opening the dialog: labelled, or an icon with a tooltip. */
export function ShareButton({
  kind,
  id,
  title,
  iconOnly = false,
}: {
  kind: ShareKind;
  id: string;
  title: string;
  /** An icon button named in its tooltip (the watch page's row), not a labelled one. */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const show = () => {
    setOpen(true);
  };
  return (
    <>
      {iconOnly ? (
        <Tooltip label="Share">
          <Button variant="icon" size="icon" aria-label="Share" onClick={show}>
            <Share2 aria-hidden />
          </Button>
        </Tooltip>
      ) : (
        <Button variant="secondary" onClick={show}>
          <Share2 aria-hidden /> Share
        </Button>
      )}
      {open ? <ShareDialog kind={kind} id={id} title={title} open onOpenChange={setOpen} /> : null}
    </>
  );
}
