import { getRouteApi } from "@tanstack/react-router";

import { GroupPage } from "@/sharing/GroupPage";

// Reads its own route's parameter, never the location (see routes/library.tsx).
const groupRoute = getRouteApi("/settings/groups/$groupId");

/** `/settings/groups/$groupId`: one of the person's groups. */
export function GroupRoute() {
  return (
    <GroupPage groupId={groupRoute.useParams({ select: (p: { groupId: string }) => p.groupId })} />
  );
}
