import {
  ChannelSummary,
  FormatProfile,
  LibraryItem,
  TagsBody,
  LibraryPage,
  type EntryDetailsBody,
  type FormatProfilePatch,
  type LibrarySort,
  type NewFormatProfileBody,
} from "@uroboros/contract";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";

import {
  ApiError,
  deleteJson,
  getJson,
  patchJson,
  postJson,
  postNoContent,
  putBytes,
  putJson,
  putNoContent,
} from "./client";
import { downloadKeys } from "./downloads";

const libraryKey = ["api", "library"] as const;

/** What the library is narrowed to; every field maps to a query parameter of `GET /api/library`. */
export interface LibraryFilters {
  q?: string;
  /** A pasted link: the entries of the video it points at. */
  url?: string;
  channel?: string;
  /** A YouTube playlist's id. */
  source?: string;
  /** A manual playlist's id. */
  playlist?: string;
  tag?: string;
  watched?: boolean;
  /** Only videos in one of the caller's playlists, of either kind (true), or in none (false). */
  inPlaylist?: boolean;
  sort?: LibrarySort;
  /** Entries per page (the server's 60 when omitted). */
  limit?: number;
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

/**
 * Whether to try a library query once more: never a search the server refused (400) or cut short
 * (503, too long or too many at once; docs/library.md "Search"), which would only add to the load.
 */
export function retryLibrary(f: LibraryFilters) {
  return (failures: number, err: unknown): boolean =>
    failures < 1 &&
    !(f.q !== undefined && err instanceof ApiError && (err.status === 400 || err.status === 503));
}

/** The caller's library, filtered, a page (60) at a time; `fetchNextPage` loads the next. */
export function useLibraryPages(f: LibraryFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...libraryKey, "pages", f],
    enabled,
    retry: retryLibrary(f),
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      getJson(`/api/library${libraryQuery(f, pageParam)}`, LibraryPage, { signal }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/**
 * A quick look into the library (the Ctrl+K palette): the first `limit` entries that match. While
 * the next text's answer loads, the last one stays on screen instead of flickering away.
 */
export function useLibraryLookup(f: LibraryFilters, enabled: boolean) {
  return useQuery({
    queryKey: [...libraryKey, "lookup", f],
    enabled,
    retry: retryLibrary(f),
    queryFn: ({ signal }) =>
      getJson(`/api/library${libraryQuery(f, null)}`, LibraryPage, { signal }),
    placeholderData: keepPreviousData,
    select: (page) => page.entries,
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

const profilePath = (id: string) => `/api/format-profiles/${encodeURIComponent(id)}`;

function useProfileMutation<A, R>(fn: (arg: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries({ queryKey: downloadKeys.profiles }),
  });
}

/** Adds a profile of the caller's own; nobody else sees it. */
export const useCreateProfile = () =>
  useProfileMutation((body: NewFormatProfileBody) =>
    postJson("/api/format-profiles", FormatProfile, body),
  );
export const usePatchProfile = () =>
  useProfileMutation(({ id, patch }: { id: string; patch: FormatProfilePatch }) =>
    patchJson(profilePath(id), FormatProfile, patch),
  );
export const useDeleteProfile = () =>
  useProfileMutation((id: string) => deleteJson(profilePath(id)));
/** Makes a built-in or own profile the one the caller downloads with when they pick none. */
export const useSetDefaultProfile = () =>
  useProfileMutation((profileId: string) =>
    putNoContent("/api/format-profiles/default", { profileId }),
  );

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

/**
 * Fetch the video's SponsorBlock segments again (its owner's, docs/automation.md#sponsorblock): the
 * live stream's `skips` event says how it went.
 */
export const refetchSkipSegments = (id: string) =>
  postNoContent(`/api/library/${encodeURIComponent(id)}/skip-segments/refetch`);

/** An uploaded video's new details (its uploader only, docs/uploads.md). */
export const editDetails = (id: string, details: EntryDetailsBody) =>
  patchJson(`/api/library/${encodeURIComponent(id)}/details`, LibraryItem, details);

/** An uploaded video's new thumbnail (its uploader only). */
export const replaceThumbnail = (id: string, image: Blob) =>
  putBytes(`/api/library/${encodeURIComponent(id)}/thumbnail`, LibraryItem, image);

export const setTags = (id: string, tags: string[]) =>
  putJson(`/api/library/${encodeURIComponent(id)}/tags`, TagsBody, { tags });
