import {
  Download,
  DownloadEvent,
  DownloadRequest,
  FormatProfile,
  QueueSelectionResult,
  type DownloadProgress,
  type NewDownloadBody,
} from "@uroboros/contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";

import { getJson, postJson, postNoContent } from "./client";

export const downloadKeys = {
  profiles: ["api", "format-profiles"] as const,
  list: (all: boolean) => ["api", "downloads", all ? "all" : "mine"] as const,
  request: (id: string) => ["api", "downloads", "requests", id] as const,
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

export const cancelDownload = (id: string) =>
  postNoContent(`/api/downloads/${encodeURIComponent(id)}/cancel`);
export const retryDownload = (id: string) =>
  postNoContent(`/api/downloads/${encodeURIComponent(id)}/retry`);

/**
 * Follows `/api/downloads/events`: state changes go into the list's cache, progress into the
 * returned map (by fetch key). A dropped stream reconnects by itself; the list is refetched then.
 */
export function useDownloadEvents(all: boolean): Map<string, DownloadProgress> {
  const client = useQueryClient();
  const [progress, setProgress] = useState(() => new Map<string, DownloadProgress>());
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const key = downloadKeys.list(all);
    const source = new EventSource(`/api/downloads/events${all ? "?all=true" : ""}`);
    source.onmessage = (message: MessageEvent<string>) => {
      const parsed = DownloadEvent.safeParse(JSON.parse(message.data));
      if (!parsed.success) return;
      const event = parsed.data;
      if (event.type === "progress") {
        setProgress((old) => new Map(old).set(event.fetchKey, event.progress));
        return;
      }
      client.setQueryData<Download[]>(key, (old = []) => {
        const rest = old.filter(
          (d) => d.id !== (event.type === "state" ? event.download.id : event.id),
        );
        return event.type === "state" ? [event.download, ...rest] : rest;
      });
    };
    source.onerror = () => {
      void client.invalidateQueries({ queryKey: key });
    };
    return () => {
      source.close();
    };
  }, [all, client]);
  return progress;
}
