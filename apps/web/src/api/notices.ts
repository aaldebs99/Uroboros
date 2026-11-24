import { NoticeList } from "@uroboros/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteJson, getJson, postNoContent } from "./client";

/**
 * The person's notifications (docs/push.md#the-list-in-the-app): the newest 50 and the unread
 * count, fetched again whenever the live stream says they changed.
 */

export const noticesKey = ["api", "notices"] as const;

export function useNotices() {
  return useQuery({
    queryKey: noticesKey,
    queryFn: ({ signal }) => getJson("/api/notices", NoticeList, { signal }),
    refetchOnWindowFocus: true,
  });
}

/** Marks read everything up to the newest notice the person saw. */
export function useMarkNoticesRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (upTo: string) => postNoContent("/api/notices/read", { upTo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: noticesKey }),
  });
}

/** Empties the list. */
export function useClearNotices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteJson("/api/notices"),
    onSuccess: () => qc.invalidateQueries({ queryKey: noticesKey }),
  });
}
