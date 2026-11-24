import type { SharedWithMe } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";
import { ListVideo, Share2 } from "lucide-react";

import { errorText } from "@/api/client";
import { useSharedWithMe } from "@/api/sharing";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TileSkeleton } from "@/components/ui/skeleton";

import { tileGrid } from "../library/VideoTile";
import { SharedTabs } from "./SharedTabs";

function SharedTile({ share }: { share: SharedWithMe }) {
  const meta = [
    `from ${share.owner}`,
    share.count === null ? null : `${String(share.count)} videos`,
  ].filter(Boolean);
  const link =
    share.kind === "entry"
      ? ({ to: "/library/$entryId", params: { entryId: share.id } } as const)
      : ({ to: "/shared/$shareId", params: { shareId: share.shareId } } as const);
  return (
    <li className="grid gap-3">
      <Link
        {...link}
        className="grid gap-3 rounded-[0.75rem] focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none"
      >
        <div className="relative aspect-video overflow-hidden rounded-[0.75rem] bg-raised">
          {share.thumbnailUrl === null ? (
            <ListVideo
              className="absolute inset-0 m-auto size-8 text-muted-foreground"
              aria-hidden
            />
          ) : (
            <img
              src={share.thumbnailUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          )}
        </div>
        <span className="line-clamp-2 font-medium md:text-[0.9375rem]/[1.3125rem]">
          {share.title}
        </span>
      </Link>
      <span className="-mt-2 text-xs text-muted-foreground">{meta.join(" · ")}</span>
    </li>
  );
}

/** Shared › With me: the videos and playlists others share with the person. */
export function SharedPage() {
  const shared = useSharedWithMe();
  const list = shared.data ?? [];
  return (
    <section className="grid w-full grid-cols-1 gap-6">
      <PageHeader title="Shared" hideTitle />
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
