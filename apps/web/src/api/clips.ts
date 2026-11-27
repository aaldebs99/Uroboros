import { ClipItem } from "@uroboros/contract";
import { useQuery } from "@tanstack/react-query";

import { getJson } from "./client";

/**
 * A clip shared on its own (docs/sharing.md#clips), the caller's or one shared with them, asked again
 * every 3 s while its copy is being made.
 */

export const clipKey = (id: string) => ["api", "clips", id] as const;

/** Whether a clip's copy is still being made. */
export const isMaking = (clip: ClipItem | null | undefined): boolean =>
  clip?.state === "queued" || clip?.state === "running";

export function useClip(id: string) {
  return useQuery({
    queryKey: clipKey(id),
    queryFn: ({ signal }) => getJson(`/api/clips/${encodeURIComponent(id)}`, ClipItem, { signal }),
    refetchInterval: (query) => (isMaking(query.state.data) ? 3000 : false),
  });
}
