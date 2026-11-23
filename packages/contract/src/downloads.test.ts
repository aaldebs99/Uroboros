import { describe, expect, it } from "vitest";
import { DOWNLOAD_ERROR_KINDS, DownloadEvent } from "./index.ts";

// A literal copy of @uroboros/ytdlp's YTDLP_ERROR_KINDS: the contract may not import the wrapper.
const YTDLP_ERROR_KINDS = [
  "unavailable",
  "private",
  "geo_blocked",
  "age_restricted",
  "rate_limited",
  "network",
  "unsupported_url",
  "unknown",
  "invalid_url",
  "invalid_arguments",
  "cancelled",
  "timed_out",
  "spawn_failed",
  "invalid_output",
];

const download = {
  id: "0190a3f2-7c1e-7000-8000-000000000001",
  owner: { id: "0190a3f2-7c1e-7000-8000-000000000002", displayName: "Alice" },
  url: "https://example.org/v",
  title: null,
  extractor: "youtube",
  videoId: "v",
  profileId: "0190a3f2-7c1e-7000-8000-000000000003",
  fetchKey: "fetch:youtube:v:p:r",
  state: "queued",
  progress: null,
  errorKind: null,
  errorMessage: null,
  stderrTail: [],
  attempts: 0,
  createdAt: "2026-11-22T10:00:00.000Z",
  startedAt: null,
  finishedAt: null,
};

describe("downloads contract", () => {
  it("has every yt-dlp error kind plus storage", () => {
    expect([...DOWNLOAD_ERROR_KINDS].sort()).toEqual([...YTDLP_ERROR_KINDS, "storage"].sort());
  });

  it("parses each event variant and refuses an unknown type", () => {
    expect(DownloadEvent.parse({ type: "state", download }).type).toBe("state");
    expect(
      DownloadEvent.parse({
        type: "progress",
        fetchKey: "fetch:youtube:v:p:r",
        progress: {
          phase: "downloading",
          percent: 50,
          downloadedBytes: 5,
          totalBytes: 10,
          speed: 1,
          eta: 5,
        },
      }).type,
    ).toBe("progress");
    expect(DownloadEvent.parse({ type: "removed", id: download.id }).type).toBe("removed");
    expect(() => DownloadEvent.parse({ type: "nope" })).toThrow();
  });
});
