import type { DownloadRequest, NewDownloadBody } from "@uroboros/contract";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { errorText } from "@/api/client";
import { submitDownload } from "@/api/downloads";
import { notify } from "@/components/ui/sonner";

import { DOWNLOAD_ERROR_TEXT } from "./errorText";

/** Where a request is finished or followed: the Downloads page opens it. */
export function requestHref(request: DownloadRequest): string {
  return `/downloads?request=${encodeURIComponent(request.id)}`;
}

/**
 * Starts downloading a link, from the Download a link dialog or the Ctrl+K palette, and follows
 * what it came to: a failure stays with the caller (`error`, and yt-dlp's own lines in `ytdlp`);
 * a channel or playlist calls `onDone` and opens its preview on the Downloads page; a video
 * queued or still being checked calls `onDone` and toasts with a View action.
 */
export function useStartDownload(onDone: () => void) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [ytdlp, setYtdlp] = useState<readonly string[]>([]);

  const open = (request: DownloadRequest) => {
    void navigate({ href: requestHref(request) });
  };

  const submit = useMutation({
    mutationFn: submitDownload,
    onSuccess: (request) => {
      switch (request.state) {
        case "failed":
          setError(
            request.errorKind === null
              ? (request.errorMessage ?? "That link cannot be downloaded.")
              : DOWNLOAD_ERROR_TEXT[request.errorKind],
          );
          setYtdlp(request.stderrTail);
          return;
        case "choosing":
          // A playlist or channel: the person picks its entries on the Downloads page.
          onDone();
          open(request);
          return;
        case "probing":
        case "queued":
          onDone();
          notify.success(request.state === "queued" ? "Queued" : "Added, checking the link", {
            detail: request.title ?? request.url,
            action: {
              label: "View",
              onClick: () => {
                open(request);
              },
            },
          });
          return;
      }
    },
    onError: (failure) => {
      setError(errorText(failure));
    },
  });

  const clear = () => {
    setError(null);
    setYtdlp([]);
  };
  return {
    start: (body: NewDownloadBody) => {
      clear();
      submit.mutate(body);
    },
    pending: submit.isPending,
    error,
    ytdlp,
    /** Shows a message of the caller's own (a link that isn't one). */
    fail: setError,
    clear,
  };
}
