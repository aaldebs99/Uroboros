import { AdminHealth } from "@uroboros/contract";
import { useQuery } from "@tanstack/react-query";

import { getJson } from "./client";

/** How often Admin › Health reads again while open: replicas check in every 15 s. */
const REFRESH_MS = 10_000;

/** Admin › Health (docs/health.md), read when the page opens and every 10 s while it shows. */
export function useAdminHealth() {
  return useQuery({
    queryKey: ["api", "admin", "health"],
    queryFn: ({ signal }) => getJson("/api/admin/health", AdminHealth, { signal }),
    staleTime: 0,
    refetchInterval: REFRESH_MS,
  });
}
