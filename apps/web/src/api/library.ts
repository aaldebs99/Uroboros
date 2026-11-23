import {
  FormatProfile,
  LibraryPage,
  type FormatProfilePatch,
  type NewFormatProfileBody,
} from "@uroboros/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteJson, getJson, patchJson, postJson } from "./client";
import { downloadKeys } from "./downloads";

const libraryKey = ["api", "library"] as const;

/** The first page of the caller's library, newest first (the paged, filtered form comes with step 4's pages). */
export function useLibrary() {
  return useQuery({
    queryKey: libraryKey,
    queryFn: ({ signal }) => getJson("/api/library", LibraryPage, { signal }),
    select: (page) => page.entries,
  });
}

export function useRemoveEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJson(`/api/library/${encodeURIComponent(id)}`),
    onSettled: () => client.invalidateQueries({ queryKey: libraryKey }),
  });
}

const profilePath = (id: string) => `/api/admin/format-profiles/${encodeURIComponent(id)}`;

function useProfileMutation<A, R>(fn: (arg: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries({ queryKey: downloadKeys.profiles }),
  });
}

export const useCreateProfile = () =>
  useProfileMutation((body: NewFormatProfileBody) =>
    postJson("/api/admin/format-profiles", FormatProfile, body),
  );
export const usePatchProfile = () =>
  useProfileMutation(({ id, patch }: { id: string; patch: FormatProfilePatch }) =>
    patchJson(profilePath(id), FormatProfile, patch),
  );
export const useDeleteProfile = () =>
  useProfileMutation((id: string) => deleteJson(profilePath(id)));
