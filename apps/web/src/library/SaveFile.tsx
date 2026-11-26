import type { LibraryItem } from "@uroboros/contract";
import { useNavigate } from "@tanstack/react-router";
import { Download, Scissors } from "lucide-react";

import { errorText } from "@/api/client";
import { exportSaveLink, useExports, useStartExport } from "@/api/exports";
import { entrySaveLink } from "@/api/library";
import { Button } from "@/components/ui/button";
import { type MenuAction, ResponsiveMenu } from "@/components/ui/responsive-menu";
import { notify } from "@/components/ui/sonner";
import { Tooltip } from "@/components/ui/tooltip";

import { SaveButton } from "./SaveButton";
import { saveAction } from "./saveInWindow";

/**
 * Save, an icon button named in its tooltip: the stored file as it is, or, on a file with
 * SponsorBlock segments the person skips, a menu that also offers a copy without them (re-encoded by the server;
 * docs/transcoding.md), which appears under Downloads › Copies to save. Once that copy is made, it
 * saves straight away, while the video's segments stay as they were cut.
 */
export function SaveFile({ item }: { item: Pick<LibraryItem, "id" | "sponsorSegments"> }) {
  const start = useStartExport();
  // A copy cuts what the person skips; shown-only segments stay in it.
  const cuts = item.sponsorSegments.some((s) => s.skip);
  const copies = useExports(cuts);
  const navigate = useNavigate();
  const fileUrl = `/api/library/${item.id}/file`;
  const entryLink = (token: string) => entrySaveLink(item.id, token);
  if (!cuts) {
    return (
      <Tooltip label="Save">
        <SaveButton variant="icon" size="icon" aria-label="Save" href={fileUrl} link={entryLink}>
          <Download aria-hidden />
        </SaveButton>
      </Tooltip>
    );
  }
  // A copy cut from segments a refetch has since changed is not this video's any more.
  const made = copies.data?.find((c) => c.entryId === item.id && c.current && c.fileUrl !== null);
  const ask = () => {
    start.mutate(item.id, {
      onSuccess: (copy) => {
        notify.success(
          copy.state === "done" ? "Your copy is ready" : "Making a copy without sponsors",
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
        notify.error(`Could not make the copy: ${errorText(err)}`);
      },
    });
  };
  // A copy made already saves at once; otherwise the server makes one (or answers the one it is making).
  const withoutSponsors: MenuAction =
    made?.fileUrl == null
      ? { label: "Without sponsors", icon: Scissors, onSelect: ask }
      : saveAction("Without sponsors", Scissors, made.fileUrl, (token) =>
          exportSaveLink(made.id, token),
        );
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
      actions={[saveAction("Original file", Download, fileUrl, entryLink), withoutSponsors]}
    />
  );
}
