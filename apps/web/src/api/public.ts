import { PublicItem, PublicShare } from "@uroboros/contract";
import { useQuery } from "@tanstack/react-query";

import { getJson } from "./client";

const linkPath = (code: string) => `/api/public/s/${encodeURIComponent(code)}`;

/** What a public link shows (docs/sharing.md); needs no sign-in. */
export function usePublicShare(code: string) {
  return useQuery({
    queryKey: ["api", "public", code],
    queryFn: ({ signal }) => getJson(linkPath(code), PublicShare, { signal }),
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
