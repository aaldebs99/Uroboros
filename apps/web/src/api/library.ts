import {
  ChannelSummary,
  FormatProfile,
  LibraryItem,
  TagsBody,
  LibraryPage,
  type FormatProfilePatch,
  type LibrarySort,
  type NewFormatProfileBody,
} from "@uroboros/contract";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { deleteJson, getJson, patchJson, postJson, putJson, putNoContent } from "./client";
import { downloadKeys } from "./downloads";

const libraryKey = ["api", "library"] as const;

/** What the library is narrowed to; every field maps to a query parameter of `GET /api/library`. */
export interface LibraryFilters {
  q?: string;
  channel?: string;
  /** A YouTube playlist's id. */
  source?: string;
  /** A manual playlist's id. */
  playlist?: string;
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
export function useLibraryPages(f: LibraryFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...libraryKey, "pages", f],
    enabled,
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

export const itemKey = (id: string) => ["api", "library", "item", id] as const;
/** One entry with its chapters, subtitles and stream URL. */
export function useItem(id: string) {
  return useQuery({
    queryKey: itemKey(id),
    queryFn: ({ signal }) =>
      getJson(`/api/library/${encodeURIComponent(id)}`, LibraryItem, { signal }),
  });
}

export const reportProgress = (id: string, position: number, duration: number) =>
  putNoContent(`/api/library/${encodeURIComponent(id)}/progress`, { position, duration });

export const setWatched = (id: string, watched: boolean) =>
  putNoContent(`/api/library/${encodeURIComponent(id)}/watched`, { watched });

/** Keep an entry from a subscription: retention never removes it. */
export const setKept = (id: string, kept: boolean) =>
  putNoContent(`/api/library/${encodeURIComponent(id)}/kept`, { kept });

export const setTags = (id: string, tags: string[]) =>
  putJson(`/api/library/${encodeURIComponent(id)}/tags`, TagsBody, { tags });
