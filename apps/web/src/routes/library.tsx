import { getRouteApi, useNavigate, useRouterState } from "@tanstack/react-router";

import type { LibraryFilters } from "@/api/library";
import { ChannelPage } from "@/library/ChannelPage";
import { ItemPage } from "@/library/ItemPage";
import { LibraryPage } from "@/library/LibraryPage";
import { PlaylistPage } from "@/library/PlaylistPage";
import type { PlayQueue } from "@/library/UpNext";

function filtersFrom(searchStr: string): LibraryFilters {
  const p = new URLSearchParams(searchStr);
  const text = (k: string) => {
    const v = p.get(k);
    return v === null || v === "" ? {} : { [k]: v };
  };
  const watched = p.get("watched");
  const sort = p.get("sort");
  return {
    ...text("q"),
    ...text("tag"),
    ...(sort === "uploaded" || sort === "title" || sort === "duration" ? { sort } : {}),
    ...(watched === "true" || watched === "false" ? { watched: watched === "true" } : {}),
  };
}

/** `/`: the library, with its search and filters kept in the URL (the top bar's search sets `q`). */
export function LibraryRoute() {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const navigate = useNavigate();
  return (
    <LibraryPage
      filters={filtersFrom(searchStr)}
      onFilters={(f) => {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(f)) if (v !== undefined) p.set(k, String(v));
        const query = p.toString();
        void navigate({ href: query === "" ? "/" : `/?${query}` });
      }}
    />
  );
}

// Each page reads its own route's parameter, never the location: while a navigation away is
// under way the location is already the next page's, and a page reading its last segment would
// fetch, say, the video "downloads" before it unmounts. The code-based route tree leaves params
// untyped (`any`), so each `select` states its parameter's type.
const channelRoute = getRouteApi("/library/channels/$channelKey");
const playlistRoute = getRouteApi("/library/playlists/$playlistId");
const itemRoute = getRouteApi("/library/$entryId");

export function ChannelRoute() {
  return (
    <ChannelPage
      channelKey={channelRoute.useParams({ select: (p: { channelKey: string }) => p.channelKey })}
    />
  );
}

export function PlaylistRoute() {
  return (
    <PlaylistPage
      playlistId={playlistRoute.useParams({ select: (p: { playlistId: string }) => p.playlistId })}
    />
  );
}

/**
 * A watch page; `?list=<playlist id>` plays one of the person's playlists in order from it, and
 * `?share=<share id>` a playlist shared with them.
 */
export function ItemRoute() {
  const entryId = itemRoute.useParams({ select: (p: { entryId: string }) => p.entryId });
  const queue = itemRoute.useSearch({ select: queueOf });
  return <ItemPage entryId={entryId} queue={queue} />;
}

function queueOf(s: { list?: unknown; share?: unknown }): PlayQueue | null {
  if (typeof s.list === "string") return { kind: "playlist", id: s.list };
  if (typeof s.share === "string") return { kind: "share", id: s.share };
  return null;
}
