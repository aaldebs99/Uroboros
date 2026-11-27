import { getRouteApi } from "@tanstack/react-router";

import { ClipPage } from "@/sharing/ClipPage";
import { SharedPlaylistPage } from "@/sharing/SharedPlaylistPage";

// Reads its own route's parameter, never the location (see routes/library.tsx).
const sharedRoute = getRouteApi("/shared/$shareId");
const clipRoute = getRouteApi("/shared/clips/$exportId");

/** `/shared/clips/$exportId`: a clip shared on its own (docs/sharing.md#clips). */
export function SharedClipRoute() {
  return (
    <ClipPage exportId={clipRoute.useParams({ select: (p: { exportId: string }) => p.exportId })} />
  );
}

/** `/shared/$shareId`: a playlist someone shared with the person. */
export function SharedPlaylistRoute() {
  return (
    <SharedPlaylistPage
      shareId={sharedRoute.useParams({ select: (p: { shareId: string }) => p.shareId })}
    />
  );
}
