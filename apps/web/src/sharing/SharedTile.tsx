import type { SharedWithMe } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";
import { ListVideo } from "lucide-react";

import { cn } from "@/lib/utils";

import { tileMeta, tileTitle } from "../library/VideoTile";

/** Where a shared thing opens: the caller's own in their library, someone else's playlist on its share page. */
function linkFor(share: SharedWithMe & { mine?: boolean }) {
  if (share.kind === "entry") {
    return { to: "/library/$entryId", params: { entryId: share.id } } as const;
  }
  if (share.mine === true) {
    return { to: "/library/playlists/$playlistId", params: { playlistId: share.id } } as const;
  }
  return { to: "/shared/$shareId", params: { shareId: share.shareId } } as const;
}

/** A shared video or playlist as a tile: its thumbnail, title, and who shared it. */
export function SharedTile({ share }: { share: SharedWithMe & { mine?: boolean } }) {
  const meta = [
    share.mine === true ? "yours" : `from ${share.owner}`,
    share.count === null ? null : `${String(share.count)} videos`,
  ].filter(Boolean);
  return (
    <li className="grid gap-3">
      <Link
        {...linkFor(share)}
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
        <span className={tileTitle}>{share.title}</span>
      </Link>
      <span className={cn("-mt-2", tileMeta)}>{meta.join(" · ")}</span>
    </li>
  );
}
