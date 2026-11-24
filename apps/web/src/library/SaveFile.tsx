import type { LibraryItem } from "@uroboros/contract";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, Download, Scissors } from "lucide-react";

import { errorText } from "@/api/client";
import { useExports, useStartExport } from "@/api/exports";
import { Button } from "@/components/ui/button";
import { type MenuAction, ResponsiveMenu } from "@/components/ui/responsive-menu";
import { notify } from "@/components/ui/sonner";

/**
 * Save: the stored file as it is, or, on a video that keeps SponsorBlock segments, a menu that
 * also offers a copy without them (re-encoded by the server; docs/transcoding.md), which appears
 * under Downloads › Copies to save. Once that copy is made, it saves straight away.
 */
export function SaveFile({ item }: { item: Pick<LibraryItem, "id" | "skipSegments"> }) {
  const start = useStartExport();
  const copies = useExports(item.skipSegments.length > 0);
  const navigate = useNavigate();
  const fileUrl = `/api/library/${item.id}/file`;
  if (item.skipSegments.length === 0) {
    return (
      <Button variant="secondary" asChild>
        <a href={fileUrl} download>
          <Download aria-hidden /> Save
        </a>
      </Button>
    );
  }
  const made = copies.data?.find((c) => c.entryId === item.id && c.fileUrl !== null)?.fileUrl;
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
    made === undefined || made === null
      ? { label: "Without sponsors", icon: Scissors, onSelect: ask }
      : { label: "Without sponsors", icon: Scissors, href: made };
  return (
    <ResponsiveMenu
      title="Save"
      align="start"
      trigger={
        <Button variant="secondary" disabled={start.isPending}>
          <Download aria-hidden /> Save <ChevronDown aria-hidden />
        </Button>
      }
      actions={[{ label: "Original file", icon: Download, href: fileUrl }, withoutSponsors]}
    />
  );
}
