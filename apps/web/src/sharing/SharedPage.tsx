import { Share2 } from "lucide-react";

import { errorText } from "@/api/client";
import { useSharedWithMe } from "@/api/sharing";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TileSkeleton } from "@/components/ui/skeleton";

import { tileGrid } from "../library/VideoTile";
import { SharedTabs } from "./SharedTabs";
import { SharedTile } from "./SharedTile";

/** Shared › With me: the videos and playlists others share with the person. */
export function SharedPage() {
  const shared = useSharedWithMe();
  const list = shared.data ?? [];
  return (
    <section className="grid w-full grid-cols-1 gap-6">
      <PageHeader title="Shared" />
      <SharedTabs />
      {shared.isError ? <p className="text-destructive">{errorText(shared.error)}</p> : null}
      {shared.isPending ? (
        <div aria-busy="true" aria-label="Loading what is shared with you" className={tileGrid}>
          {Array.from({ length: 4 }, (_, i) => (
            <TileSkeleton key={i} />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={Share2} title="Nothing shared with you yet.">
          When someone shares a video or a playlist with you, it shows up here.
        </EmptyState>
      ) : (
        <ul className={tileGrid}>
          {list.map((s) => (
            <SharedTile key={s.shareId} share={s} />
          ))}
        </ul>
      )}
    </section>
  );
}
