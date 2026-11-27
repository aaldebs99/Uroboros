import {
  answersClip,
  type ClipRange,
  type Export,
  type LibraryItem,
  roundClip,
} from "@uroboros/contract";
import { useNavigate } from "@tanstack/react-router";
import { Download, type LucideIcon, Scissors, ScissorsLineDashed } from "lucide-react";

import { errorText } from "@/api/client";
import { exportSaveLink, useExports, useStartExport } from "@/api/exports";
import { entrySaveLink } from "@/api/library";
import { Button } from "@/components/ui/button";
import { type MenuAction, ResponsiveMenu } from "@/components/ui/responsive-menu";
import { notify } from "@/components/ui/sonner";
import { Tooltip } from "@/components/ui/tooltip";

import { clipLabel } from "./clipRange";
import { SaveButton } from "./SaveButton";
import { saveAction } from "./saveInWindow";

/**
 * Save, an icon button named in its tooltip: the stored file as it is, or a menu that also offers,
 * on a file with SponsorBlock segments the person skips, a copy without them, and with a `clip`
 * picked in the player (docs/sharing.md#clips) just that range, first. Both are cut by the server
 * (docs/transcoding.md) and appear under Downloads › Copies to save; once made, one saves straight
 * away (a copy without sponsors while the video's segments stay as they were cut).
 */
export function SaveFile({
  item,
  clip = null,
}: {
  item: Pick<LibraryItem, "id" | "sponsorSegments">;
  clip?: ClipRange | null;
}) {
  const start = useStartExport();
  // A copy cuts what the person skips; shown-only segments stay in it.
  const cuts = item.sponsorSegments.some((s) => s.skip);
  const copies = useExports(cuts || clip !== null);
  const navigate = useNavigate();
  const fileUrl = `/api/library/${item.id}/file`;
  const entryLink = (token: string) => entrySaveLink(item.id, token);
  if (!cuts && clip === null) {
    return (
      <Tooltip label="Save">
        <SaveButton variant="icon" size="icon" aria-label="Save" href={fileUrl} link={entryLink}>
          <Download aria-hidden />
        </SaveButton>
      </Tooltip>
    );
  }
  const asked = clip === null ? null : roundClip(clip);
  const ready = (match: (c: Export) => boolean) =>
    copies.data?.find((c) => c.entryId === item.id && c.fileUrl !== null && match(c));
  const ask = (wanted: ClipRange | null) => () => {
    start.mutate(
      { entryId: item.id, clip: wanted },
      {
        onSuccess: (copy) => {
          const done = copy.state === "done";
          const what = wanted === null ? "copy" : "clip";
          notify.success(
            done
              ? `Your ${what} is ready`
              : wanted === null
                ? "Making a copy without sponsors"
                : "Making the clip",
            {
              detail: "Find it under Downloads › Copies to save.",
              action: {
                label: "View",
                onClick: () => {
                  void navigate({ to: "/downloads" });
                },
              },
            },
          );
        },
        onError: (err) => {
          notify.error(
            `Could not make the ${wanted === null ? "copy" : "clip"}: ${errorText(err)}`,
          );
        },
      },
    );
  };
  // A copy made already saves at once; otherwise the server makes one (or answers the one it is making).
  const copyAction = (
    label: string,
    icon: LucideIcon,
    made: Export | undefined,
    onAsk: () => void,
  ): MenuAction =>
    made?.fileUrl == null
      ? { label, icon, onSelect: onAsk }
      : saveAction(label, icon, made.fileUrl, (token) => exportSaveLink(made.id, token));
  const actions: MenuAction[] = [
    ...(asked === null
      ? []
      : [
          copyAction(
            `This clip (${clipLabel(asked)})`,
            ScissorsLineDashed,
            ready((c) => answersClip(asked, c)),
            ask(asked),
          ),
        ]),
    saveAction("Original file", Download, fileUrl, entryLink),
    ...(cuts
      ? [
          copyAction(
            "Without sponsors",
            Scissors,
            // A copy cut from segments a refetch has since changed is not this video's any more.
            ready((c) => c.clip === null && c.current),
            ask(null),
          ),
        ]
      : []),
  ];
  return (
    <ResponsiveMenu
      title="Save"
      align="start"
      trigger={
        <Tooltip label="Save">
          <Button variant="icon" size="icon" aria-label="Save" disabled={start.isPending}>
            <Download aria-hidden />
          </Button>
        </Tooltip>
      }
      actions={actions}
    />
  );
}
