import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";

import { rangeOf } from "@/library/clipRange";
import { PublicPage } from "@/sharing/PublicPage";

import { startOf } from "./library";

const publicRoute = getRouteApi("/s/$code");

/**
 * `/s/$code`: a public link, outside the sign-in gate; `?t=<seconds>&end=<seconds>` opens its video
 * at a clip (docs/sharing.md#clips).
 */
export function PublicRoute() {
  const code = publicRoute.useParams({ select: (p: { code: string }) => p.code });
  const startAt = publicRoute.useSearch({ select: startOf });
  const end = publicRoute.useSearch({ select: (s: { end?: unknown }) => startOf({ t: s.end }) });
  const range = useMemo(() => rangeOf({ t: startAt, end }), [startAt, end]);
  return <PublicPage code={code} startAt={startAt} range={range} />;
}
