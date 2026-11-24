import type { DownloadErrorKind } from "@uroboros/contract";
import { YtDlpError, type YtDlpErrorKind } from "@uroboros/ytdlp";

/** A file that could not be stored. */
export class StorageError extends Error {
  override readonly name = "StorageError";
}

interface KindInfo {
  retry: boolean;
  message: string;
}

/** Exhaustive over the wrapper's kinds: whether a fetch retries, and what the server records. */
const KINDS: Record<YtDlpErrorKind, KindInfo> = {
  unavailable: { retry: false, message: "the video is unavailable" },
  private: { retry: false, message: "the video is private" },
  geo_blocked: { retry: false, message: "the video is blocked in the server's country" },
  age_restricted: { retry: false, message: "the video needs an age-verified account" },
  login_required: { retry: false, message: "the site needs a signed-in account" },
  login_failed: { retry: false, message: "the site refused the saved login" },
  rate_limited: { retry: true, message: "the site is limiting requests" },
  network: { retry: true, message: "the site could not be reached" },
  unsupported_url: { retry: false, message: "yt-dlp does not support this link" },
  unknown: { retry: true, message: "yt-dlp failed" },
  invalid_url: { retry: false, message: "not an http(s) link" },
  invalid_arguments: { retry: false, message: "the format profile has a refused argument" },
  cancelled: { retry: false, message: "cancelled" },
  timed_out: { retry: true, message: "yt-dlp took too long" },
  spawn_failed: { retry: false, message: "yt-dlp could not be started" },
  invalid_output: { retry: false, message: "yt-dlp's output could not be read" },
};

export interface DownloadFailure {
  kind: DownloadErrorKind;
  message: string;
  stderrTail: string[];
  retry: boolean;
}

export function toDownloadError(err: unknown): DownloadFailure {
  if (err instanceof YtDlpError) {
    const info = KINDS[err.kind];
    return { kind: err.kind, message: info.message, stderrTail: err.stderrTail, retry: info.retry };
  }
  if (err instanceof StorageError) {
    return {
      kind: "storage",
      message: "the file could not be stored",
      stderrTail: [err.message],
      retry: true,
    };
  }
  const text = err instanceof Error ? err.message : String(err);
  return { kind: "unknown", message: "the download failed", stderrTail: [text], retry: true };
}
