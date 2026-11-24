import type { LibraryItem } from "@uroboros/contract";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, Download, Scissors } from "lucide-react";

import { errorText } from "@/api/client";
import { useStartExport } from "@/api/exports";
import { Button } from "@/components/ui/button";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { notify } from "@/components/ui/sonner";

/**
 * Save: the stored file as it is, or, on a video that keeps SponsorBlock segments, a menu that
 * also offers a copy without them (re-encoded by the server; docs/transcoding.md), which appears
 * under Downloads › Copies to save.
 */
export function SaveFile({ item }: { item: Pick<LibraryItem, "id" | "skipSegments"> }) {
  const start = useStartExport();
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
  return (
    <ResponsiveMenu
      title="Save"
      align="start"
      trigger={
        <Button variant="secondary" disabled={start.isPending}>
          <Download aria-hidden /> Save <ChevronDown aria-hidden />
        </Button>
      }
      actions={[
        { label: "Original file", icon: Download, href: fileUrl },
        {
          label: "Without sponsors",
          icon: Scissors,
          onSelect: () => {
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
          },
        },
      ]}
    />
  );
}
