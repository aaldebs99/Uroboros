import {
  ChannelSummary,
  FormatProfile,
  LibraryPage,
  SourceSummary,
  type FormatProfilePatch,
  type LibrarySort,
  type NewFormatProfileBody,
} from "@uroboros/contract";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { deleteJson, getJson, patchJson, postJson } from "./client";
import { downloadKeys } from "./downloads";

const libraryKey = ["api", "library"] as const;

/** What the library is narrowed to; every field maps to a query parameter of `GET /api/library`. */
export interface LibraryFilters {
  q?: string;
  channel?: string;
  source?: string;
  tag?: string;
  watched?: boolean;
  sort?: LibrarySort;
}

export function libraryQuery(f: LibraryFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== "") params.set(k, String(v));
  }
  if (cursor !== null) params.set("cursor", cursor);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** The caller's library, filtered, a page (60) at a time; `fetchNextPage` loads the next. */
export function useLibraryPages(f: LibraryFilters) {
  return useInfiniteQuery({
    queryKey: [...libraryKey, "pages", f],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      getJson(`/api/library${libraryQuery(f, pageParam)}`, LibraryPage, { signal }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** The first page, newest first. */
export function useLibrary() {
  return useQuery({
    queryKey: libraryKey,
    queryFn: ({ signal }) => getJson("/api/library", LibraryPage, { signal }),
    select: (page) => page.entries,
  });
}

export function useChannels() {
  return useQuery({
    queryKey: [...libraryKey, "channels"],
    queryFn: ({ signal }) => getJson("/api/library/channels", z.array(ChannelSummary), { signal }),
  });
}

export function useSources() {
  return useQuery({
    queryKey: [...libraryKey, "sources"],
    queryFn: ({ signal }) => getJson("/api/library/sources", z.array(SourceSummary), { signal }),
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
