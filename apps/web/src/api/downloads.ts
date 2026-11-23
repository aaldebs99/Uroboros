import { DownloadRequest, FormatProfile, type NewDownloadBody } from "@uroboros/contract";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { getJson, postJson } from "./client";

export const downloadKeys = {
  profiles: ["api", "format-profiles"] as const,
};

/** The format profiles anyone signed in may pick from; the default is flagged. */
export function useProfiles() {
  return useQuery({
    queryKey: downloadKeys.profiles,
    queryFn: ({ signal }) => getJson("/api/format-profiles", z.array(FormatProfile), { signal }),
  });
}

/**
 * Starts a download: the server probes the link. A video moves on by itself; a playlist or channel
 * comes back `choosing` and is finished from its preview (`/downloads?request=<id>`).
 */
export function submitDownload(body: NewDownloadBody): Promise<DownloadRequest> {
  return postJson("/api/downloads", DownloadRequest, body);
}
