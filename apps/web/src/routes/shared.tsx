import { getRouteApi } from "@tanstack/react-router";

import { SharedPlaylistPage } from "@/sharing/SharedPlaylistPage";

// Reads its own route's parameter, never the location (see routes/library.tsx).
const sharedRoute = getRouteApi("/shared/$shareId");

/** `/shared/$shareId`: a playlist someone shared with the person. */
export function SharedPlaylistRoute() {
  return (
    <SharedPlaylistPage
      shareId={sharedRoute.useParams({ select: (p: { shareId: string }) => p.shareId })}
    />
  );
}
