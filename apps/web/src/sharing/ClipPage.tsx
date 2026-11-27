import { Scissors } from "lucide-react";

import { useClip } from "@/api/clips";
import { exportSaveLink } from "@/api/exports";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState } from "@/components/ui/empty-state";

import { ClipView } from "./ClipView";

/**
 * `/shared/clips/$exportId`: a clip shared on its own (docs/sharing.md#clips), the person's own or
 * one shared with them, under Shared.
 */
export function ClipPage({ exportId }: { exportId: string }) {
  const clip = useClip(exportId);
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <BackLink to="/shared">Shared</BackLink>
      {clip.isError ? (
        <EmptyState icon={Scissors} title="This clip isn't shared with you">
          It may have been removed, or its sharing stopped.
        </EmptyState>
      ) : clip.data === undefined ? (
        <div
          aria-busy="true"
          className="aspect-video bg-raised max-md:-mx-4 md:rounded-[0.75rem]"
        />
      ) : (
        <ClipView
          clip={clip.data}
          link={clip.data.owner === null ? (token) => exportSaveLink(exportId, token) : undefined}
        />
      )}
    </div>
  );
}
