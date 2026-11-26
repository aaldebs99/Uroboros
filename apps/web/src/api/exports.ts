import { Export, SaveLink } from "@uroboros/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { deleteJson, getJson, postJson } from "./client";

/**
 * Copies to save without SponsorBlock segments (docs/transcoding.md): ask for one of an entry,
 * watch it being made, save it, remove it.
 */

export const exportsKey = ["api", "exports"] as const;

const isMaking = (e: Export) => e.state === "queued" || e.state === "running";

/** The person's copies, asked again every 3 s while any is being made; none asked while not `enabled`. */
export function useExports(enabled = true) {
  return useQuery({
    queryKey: exportsKey,
    enabled,
    queryFn: ({ signal }) => getJson("/api/exports", z.array(Export), { signal }),
    refetchInterval: (query) => (query.state.data?.some(isMaking) === true ? 3000 : false),
  });
}

/** Asks for a copy of an entry without its sponsor segments (the same one again if asked already). */
export function useStartExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) =>
      postJson(`/api/library/${encodeURIComponent(entryId)}/export`, Export),
    onSuccess: () => qc.invalidateQueries({ queryKey: exportsKey }),
  });
}

/**
 * A short-lived link that saves a finished copy without the session cookie, for the installed
 * iPhone app's Save window (docs/downloads.md#saving-a-file).
 */
export const exportSaveLink = (id: string) =>
  postJson(`/api/exports/${encodeURIComponent(id)}/save-link`, SaveLink).then((l) => l.url);

/** Removes a copy, stopping it if it is being made. */
export function useRemoveExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJson(`/api/exports/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: exportsKey }),
  });
}
