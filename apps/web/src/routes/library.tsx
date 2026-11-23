import { useNavigate, useRouterState } from "@tanstack/react-router";

import type { LibraryFilters } from "@/api/library";
import { ChannelPage } from "@/library/ChannelPage";
import { LibraryPage } from "@/library/LibraryPage";
import { PlaylistPage } from "@/library/PlaylistPage";

function filtersFrom(searchStr: string): LibraryFilters {
  const p = new URLSearchParams(searchStr);
  const text = (k: string) => {
    const v = p.get(k);
    return v === null || v === "" ? {} : { [k]: v };
  };
  const watched = p.get("watched");
  return {
    ...text("q"),
    ...text("tag"),
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

/** The route's last path segment, decoded (the `$channelKey` or `$sourceId` param). */
function useLastSegment(): string {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "");
}

export function ChannelRoute() {
  return <ChannelPage channelKey={useLastSegment()} />;
}

export function PlaylistRoute() {
  return <PlaylistPage sourceId={useLastSegment()} />;
}
