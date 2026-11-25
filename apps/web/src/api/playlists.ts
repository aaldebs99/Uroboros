import {
  PlaylistDetail,
  PlaylistSummary,
  type NewPlaylistBody,
  type PlaylistPatch,
} from "@uroboros/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { deleteJson, getJson, patchJson, postJson, postNoContent, putNoContent } from "./client";
import type { LibraryFilters } from "./library";

const playlistsKey = ["api", "playlists"] as const;

/** The library filter listing a playlist's videos in its order. */
export const playlistFilters = (p: { kind: PlaylistDetail["kind"]; id: string }): LibraryFilters =>
  p.kind === "manual" ? { playlist: p.id } : { source: p.id };
const path = (id: string) => `/api/playlists/${encodeURIComponent(id)}`;

/** The caller's playlists: manual ones first, then YouTube ones (docs/sharing.md). */
export function usePlaylists() {
  return useQuery({
    queryKey: playlistsKey,
    queryFn: ({ signal }) => getJson("/api/playlists", z.array(PlaylistSummary), { signal }),
  });
}

/** One of the caller's playlists, of either kind. */
export function usePlaylist(id: string | null) {
  return useQuery({
    queryKey: [...playlistsKey, id],
    enabled: id !== null,
    queryFn: ({ signal }) => getJson(path(id ?? ""), PlaylistDetail, { signal }),
  });
}

/** A playlist change, refreshing playlists and the library (a playlist filters its listing). */
export function usePlaylistAction<A, R>(fn: (arg: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: playlistsKey }),
        client.invalidateQueries({ queryKey: ["api", "library"] }),
      ]),
  });
}

export const createPlaylist = (body: NewPlaylistBody) =>
  postJson("/api/playlists", PlaylistDetail, body);
export const updatePlaylist = ({ id, patch }: { id: string; patch: PlaylistPatch }) =>
  patchJson(path(id), PlaylistDetail, patch);
export const deletePlaylist = (id: string) => deleteJson(path(id));
/** Keeps the playlist's videos out of Library › Videos and Audio, or lets them back (docs/library.md). */
export const setPlaylistHidden = ({ id, hidden }: { id: string; hidden: boolean }) =>
  putNoContent(`${path(id)}/hidden`, { hidden });
export const copyPlaylist = (id: string) => postJson(`${path(id)}/copy`, PlaylistDetail);
export const appendToPlaylist = ({ id, entryIds }: { id: string; entryIds: string[] }) =>
  postNoContent(`${path(id)}/items`, { entryIds });
export const removeFromPlaylist = ({ id, entryId }: { id: string; entryId: string }) =>
  deleteJson(`${path(id)}/items/${encodeURIComponent(entryId)}`);
export const movePlaylistItem = ({
  id,
  entryId,
  position,
}: {
  id: string;
  entryId: string;
  position: number;
}) => postNoContent(`${path(id)}/items/${encodeURIComponent(entryId)}/move`, { position });
