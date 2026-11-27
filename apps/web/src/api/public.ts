import { PublicItem, PublicShare } from "@uroboros/contract";
import { useQuery } from "@tanstack/react-query";

import { getJson } from "./client";
import { isMaking } from "./clips";

const linkPath = (code: string) => `/api/public/s/${encodeURIComponent(code)}`;

/**
 * What a public link shows (docs/sharing.md); needs no sign-in: its title and videos, or its clip
 * (asked again every 3 s while that is being made).
 */
export function usePublicShare(code: string) {
  return useQuery({
    queryKey: ["api", "public", code],
    queryFn: ({ signal }) => getJson(linkPath(code), PublicShare, { signal }),
    refetchInterval: (query) => (isMaking(query.state.data?.clip) ? 3000 : false),
  });
}

/** One of a link's videos, with what its player needs. */
export function usePublicItem(code: string, id: string | null) {
  return useQuery({
    queryKey: ["api", "public", code, id],
    enabled: id !== null,
    queryFn: ({ signal }) =>
      getJson(`${linkPath(code)}/items/${encodeURIComponent(id ?? "")}`, PublicItem, { signal }),
  });
}
