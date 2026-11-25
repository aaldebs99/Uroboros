import {
  Download,
  DownloadRequest,
  FormatProfile,
  QueueSelectionResult,
  ReadyPreview,
  type DownloadProgress,
  type NewDownloadBody,
} from "@uroboros/contract";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";

import { getJson, postJson, postNoContent, putNoContent } from "./client";
import { openStream } from "./liveEvents";

export const downloadKeys = {
  profiles: ["api", "format-profiles"] as const,
  list: (all: boolean) => ["api", "downloads", all ? "all" : "mine"] as const,
  /** The caller's queued and running downloads, for the bell. */
  active: ["api", "downloads", "active"] as const,
  request: (id: string) => ["api", "downloads", "requests", id] as const,
  /** The caller's pasted playlists and channels waiting for a pick, for the bell. */
  ready: ["api", "downloads", "requests"] as const,
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

/** A pasted link; polled every second while a worker probes it. */
export function useRequest(id: string | null) {
  return useQuery({
    queryKey: downloadKeys.request(id ?? ""),
    enabled: id !== null,
    queryFn: ({ signal }) =>
      getJson(`/api/downloads/requests/${encodeURIComponent(id ?? "")}`, DownloadRequest, {
        signal,
      }),
    refetchInterval: (query) => (query.state.data?.state === "probing" ? 1000 : false),
  });
}

/** Asks a worker to list YouTube's top videos for `query`: a request polled like a pasted link's. */
export function searchYouTube(query: string): Promise<DownloadRequest> {
  return postJson("/api/downloads/search", DownloadRequest, { query });
}

/**
 * The caller's pasted playlists and channels whose previews wait for a pick, for a day from when
 * each was ready (docs/downloads.md); the stream's `requests` nudge says when they change.
 */
export function useReadyPreviews() {
  return useQuery({
    queryKey: downloadKeys.ready,
    queryFn: ({ signal }) => getJson("/api/downloads/requests", z.array(ReadyPreview), { signal }),
  });
}

/** Keeps the entries picked so far in a preview, so it opens with them again. */
export function saveSelection(id: string, entryIds: string[]): Promise<void> {
  return putNoContent(`/api/downloads/requests/${encodeURIComponent(id)}/selection`, {
    entryIds,
  });
}

export function queueSelection(id: string, entryIds: string[]) {
  return postJson(`/api/downloads/requests/${encodeURIComponent(id)}/queue`, QueueSelectionResult, {
    entryIds,
  });
}

/** The caller's downloads (everyone's for an admin with `all`), active first. */
export function useDownloads(all: boolean) {
  return useQuery({
    queryKey: downloadKeys.list(all),
    queryFn: ({ signal }) =>
      getJson(`/api/downloads${all ? "?all=true" : ""}`, z.array(Download), { signal }),
  });
}

/** The caller's queued and running downloads, kept current by the live events. */
export function useActiveDownloads() {
  return useQuery({
    queryKey: downloadKeys.active,
    queryFn: ({ signal }) => getJson("/api/downloads?active=true", z.array(Download), { signal }),
  });
}

const isActive = (d: Download) => d.state === "queued" || d.state === "running";

/**
 * Puts a download's change into the cached lists: the newest first in the full list, and in or
 * out of the active one. A list not loaded yet stays unloaded.
 */
export function applyDownloadChange(
  client: QueryClient,
  lists: { list: readonly unknown[]; active?: readonly unknown[] },
  change: { download: Download } | { removed: string },
): void {
  const id = "download" in change ? change.download.id : change.removed;
  const put = (keep: boolean) => (old: Download[] | undefined) => {
    if (old === undefined) return undefined;
    const rest = old.filter((d) => d.id !== id);
    return "download" in change && keep ? [change.download, ...rest] : rest;
  };
  client.setQueryData<Download[]>(lists.list, put(true));
  if (lists.active !== undefined) {
    const keep = "download" in change && isActive(change.download);
    client.setQueryData<Download[]>(lists.active, put(keep));
  }
}

export const cancelDownload = (id: string) =>
  postNoContent(`/api/downloads/${encodeURIComponent(id)}/cancel`);
export const retryDownload = (id: string) =>
  postNoContent(`/api/downloads/${encodeURIComponent(id)}/retry`);

/**
 * Follows everyone's live download events, for an admin's everyone view: state changes go into
 * that list's cache, progress into the returned map (by fetch key). The caller's own view uses the
 * shell's shared stream instead (`useMyDownloadProgress`).
 */
export function useEveryoneDownloadEvents(enabled: boolean): Map<string, DownloadProgress> {
  const client = useQueryClient();
  const [progress, setProgress] = useState(() => new Map<string, DownloadProgress>());
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const list = downloadKeys.list(true);
    return openStream("/api/downloads/events?all=true", (message) => {
      if (message.kind === "gap") {
        void client.invalidateQueries({ queryKey: list });
        return;
      }
      const event = message.event;
      if (event.type === "progress") {
        setProgress((old) => new Map(old).set(event.fetchKey, event.progress));
      } else if (event.type === "state") {
        applyDownloadChange(client, { list }, { download: event.download });
      } else if (event.type === "removed") {
        applyDownloadChange(client, { list }, { removed: event.id });
      }
    });
  }, [enabled, client]);
  return progress;
}
