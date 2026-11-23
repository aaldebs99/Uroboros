import {
  Directory,
  EntryRef,
  LibraryPage,
  PlaylistDetail,
  SharedDetail,
  SharedWithMe,
  ShareState,
  type PeopleShareBody,
  type PublicLinkBody,
  type ShareKind,
} from "@uroboros/contract";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { deleteJson, getJson, postJson, putJson } from "./client";

const sharesKey = ["api", "shares"] as const;
const sharedKey = ["api", "shared"] as const;
const target = (kind: ShareKind, id: string) => `/api/shares/${kind}/${encodeURIComponent(id)}`;
const sharedPath = (shareId: string) => `/api/shared/${encodeURIComponent(shareId)}`;

/** How one of the caller's things is shared (docs/sharing.md). */
export function useShareState(kind: ShareKind, id: string, enabled = true) {
  return useQuery({
    queryKey: [...sharesKey, kind, id],
    enabled,
    queryFn: ({ signal }) => getJson(target(kind, id), ShareState, { signal }),
  });
}

/** Everything the caller shares (Shared › By me). */
export function useMyShares() {
  return useQuery({
    queryKey: sharesKey,
    queryFn: ({ signal }) => getJson("/api/shares", z.array(ShareState), { signal }),
  });
}

/** What others share with the caller (Shared › With me). */
export function useSharedWithMe() {
  return useQuery({
    queryKey: sharedKey,
    queryFn: ({ signal }) => getJson("/api/shared", z.array(SharedWithMe), { signal }),
  });
}

export function useSharedDetail(shareId: string | null) {
  return useQuery({
    queryKey: [...sharedKey, shareId],
    enabled: shareId !== null,
    queryFn: ({ signal }) => getJson(sharedPath(shareId ?? ""), SharedDetail, { signal }),
  });
}

/** A share's videos in order, a page at a time, with the caller's own progress. */
export function useSharedPages(shareId: string | null) {
  return useInfiniteQuery({
    queryKey: [...sharedKey, shareId, "entries"],
    enabled: shareId !== null,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      getJson(
        `${sharedPath(shareId ?? "")}/entries${pageParam === null ? "" : `?cursor=${encodeURIComponent(pageParam)}`}`,
        LibraryPage,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Who the caller can share with. */
export function useDirectory(enabled: boolean) {
  return useQuery({
    queryKey: ["api", "directory"],
    enabled,
    queryFn: ({ signal }) => getJson("/api/directory", Directory, { signal }),
  });
}

/**
 * A sharing change. A change answering the new state puts it in place (the dialog shows it at
 * once); a stop has no answer, so every share query is fetched again. By me always is.
 */
export function useShareAction<A, R>(fn: (arg: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (answer) => {
      const parsed = ShareState.safeParse(answer);
      if (parsed.success) {
        client.setQueryData([...sharesKey, parsed.data.kind, parsed.data.id], parsed.data);
        await client.invalidateQueries({ queryKey: sharesKey, exact: true });
      } else {
        await client.invalidateQueries({ queryKey: sharesKey });
      }
    },
  });
}

type Target = { kind: ShareKind; id: string };

export const setPeople = ({ kind, id, body }: Target & { body: PeopleShareBody }) =>
  putJson(`${target(kind, id)}/people`, ShareState, body);
export const stopPeople = ({ kind, id }: Target) => deleteJson(`${target(kind, id)}/people`);
export const setLink = ({ kind, id, body }: Target & { body: PublicLinkBody }) =>
  putJson(`${target(kind, id)}/link`, ShareState, body);
export const stopLink = ({ kind, id }: Target) => deleteJson(`${target(kind, id)}/link`);

/** Save as my playlist, from a shared playlist. */
export const saveShared = (shareId: string) =>
  postJson(`${sharedPath(shareId)}/save`, PlaylistDetail);

/** Add to my library: the caller's own entry on the same file. */
export const addToLibrary = (entryId: string) =>
  postJson(`/api/library/${encodeURIComponent(entryId)}/add`, EntryRef);
