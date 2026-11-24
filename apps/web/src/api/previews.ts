import { PreviewWork } from "@uroboros/contract";
import { useQuery } from "@tanstack/react-query";

import { getJson } from "./client";

/**
 * The caller's hover previews being made (docs/library.md "Hover previews"), for the bell. The live
 * stream's `previews` nudge says when to ask again; while any wait, it is asked every 15 s too.
 */
export const previewsKey = ["api", "previews"] as const;

export function usePreviewWork() {
  return useQuery({
    queryKey: previewsKey,
    queryFn: ({ signal }) => getJson("/api/previews", PreviewWork, { signal }),
    refetchInterval: (query) => ((query.state.data?.waiting ?? 0) > 0 ? 15_000 : false),
  });
}
