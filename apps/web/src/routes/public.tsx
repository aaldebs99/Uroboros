import { getRouteApi } from "@tanstack/react-router";

import { PublicPage } from "@/sharing/PublicPage";

const publicRoute = getRouteApi("/s/$code");

/** `/s/$code`: a public link, outside the sign-in gate. */
export function PublicRoute() {
  return <PublicPage code={publicRoute.useParams({ select: (p: { code: string }) => p.code })} />;
}
