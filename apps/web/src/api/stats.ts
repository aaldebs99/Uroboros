import { AdminStats } from "@uroboros/contract";
import { useQuery } from "@tanstack/react-query";

import { getJson } from "./client";

/** Admin › Stats (docs/library.md "Stats"), read each time the page opens. */
export function useAdminStats() {
  return useQuery({
    queryKey: ["api", "admin", "stats"],
    queryFn: ({ signal }) => getJson("/api/admin/stats", AdminStats, { signal }),
    staleTime: 0,
  });
}
