import type { DownloadErrorKind } from "@uroboros/contract";

/** What each failure means, for people. Exhaustive: a new kind fails `tsc` until it has words. */
export const DOWNLOAD_ERROR_TEXT = {
  unavailable: "This video is unavailable.",
  private: "This video is private.",
  geo_blocked: "This video isn't available in the server's country.",
  age_restricted: "This video needs a signed-in, age-verified account (add cookies).",
  rate_limited: "The site is limiting requests. It will retry.",
  network: "The site couldn't be reached. It will retry.",
  unsupported_url: "yt-dlp doesn't support this link.",
  unknown: "The download failed.",
  invalid_url: "That isn't an http(s) link.",
  invalid_arguments: "The format profile has an argument yt-dlp refuses.",
  cancelled: "Cancelled.",
  timed_out: "yt-dlp took too long. It will retry.",
  spawn_failed: "yt-dlp couldn't be started on the server.",
  invalid_output: "yt-dlp's output couldn't be read.",
  storage: "The file couldn't be stored.",
} as const satisfies Record<DownloadErrorKind, string>;
