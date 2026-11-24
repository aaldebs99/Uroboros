import type { DownloadRequest, PreviewEntry } from "@uroboros/contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorText } from "@/api/client";
import { downloadKeys, queueSelection, searchYouTube, useRequest } from "@/api/downloads";
import { notify } from "@/components/ui/sonner";
import { DOWNLOAD_ERROR_TEXT } from "@/downloads/errorText";

/** Where one of YouTube's results stands once someone chose it. */
export type ResultState = "queueing" | "queued" | "have";

function failureText(request: DownloadRequest): string {
  if (request.errorKind !== null) return DOWNLOAD_ERROR_TEXT[request.errorKind];
  return request.errorMessage ?? "The search didn't work.";
}

/**
 * The palette's YouTube search: `begin(query)` asks a worker for the top results (a request that
 * is polled until it lists them), and `download(result)` queues one of them, keeping the search
 * open for more. Everything it reports is for `query`, the words it last searched for.
 */
export function useYouTubeSearch() {
  const client = useQueryClient();
  const [search, setSearch] = useState<{ query: string; requestId: string } | null>(null);
  const [states, setStates] = useState<ReadonlyMap<string, ResultState>>(new Map());
  const request = useRequest(search?.requestId ?? null).data;

  const mark = (id: string, state: ResultState | null) => {
    setStates((now) => {
      const next = new Map(now);
      if (state === null) next.delete(id);
      else next.set(id, state);
      return next;
    });
  };

  const begin = useMutation({
    mutationFn: searchYouTube,
    onSuccess: (created, query) => {
      // Polled from here on, starting from what the server just said.
      client.setQueryData(downloadKeys.request(created.id), created);
      setSearch({ query, requestId: created.id });
      setStates(new Map());
    },
  });

  const queue = useMutation({
    mutationFn: ({ requestId, result }: { requestId: string; result: PreviewEntry }) =>
      queueSelection(requestId, [result.id]),
    onMutate: ({ result }) => {
      mark(result.id, "queueing");
    },
    onSuccess: (counts, { result }) => {
      const queued = counts.queued > 0;
      mark(result.id, queued ? "queued" : "have");
      notify.success(queued ? "Queued" : "Already in your library", {
        detail: result.title ?? result.url,
      });
    },
    onError: (failure, { result }) => {
      mark(result.id, null);
      notify.error(errorText(failure));
    },
  });

  const listed = request?.state === "choosing";
  return {
    query: begin.isPending ? begin.variables : (search?.query ?? null),
    begin: (query: string) => {
      begin.mutate(query);
    },
    /** Waiting for the request, or for the worker to list it. */
    pending: begin.isPending || request?.state === "probing",
    results: listed ? request.groups.flatMap((g) => g.entries) : null,
    error: begin.isError
      ? errorText(begin.error)
      : request?.state === "failed"
        ? failureText(request)
        : null,
    ytdlp: request?.state === "failed" ? request.stderrTail : [],
    states,
    download: (result: PreviewEntry) => {
      if (search === null || states.has(result.id)) return;
      queue.mutate({ requestId: search.requestId, result });
    },
  };
}
