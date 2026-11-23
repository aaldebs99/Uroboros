import { useRouterState } from "@tanstack/react-router";

import { useMe } from "@/api/auth";
import { DownloadsPage } from "@/downloads/DownloadsPage";

/** `/downloads`; `?request=<id>` opens that link's preview (the top bar's quick add sends it). */
export function DownloadsRoute() {
  const me = useMe().data;
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const requestId = new URLSearchParams(searchStr).get("request");
  return me ? <DownloadsPage me={me} requestId={requestId} /> : null;
}
