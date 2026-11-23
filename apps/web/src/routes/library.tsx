import { getRouteApi, useNavigate, useRouterState } from "@tanstack/react-router";

import type { LibraryFilters } from "@/api/library";
import { ChannelPage } from "@/library/ChannelPage";
import { ItemPage } from "@/library/ItemPage";
import { LibraryPage } from "@/library/LibraryPage";
import { PlaylistPage } from "@/library/PlaylistPage";

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
const playlistRoute = getRouteApi("/library/playlists/$sourceId");
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
      sourceId={playlistRoute.useParams({ select: (p: { sourceId: string }) => p.sourceId })}
    />
  );
}

export function ItemRoute() {
  return (
    <ItemPage entryId={itemRoute.useParams({ select: (p: { entryId: string }) => p.entryId })} />
  );
}
