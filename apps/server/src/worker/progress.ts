import type { DownloadProgress } from "@uroboros/contract";
import type { ProgressEvent } from "@uroboros/ytdlp";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { saveProgress } from "../downloads/events.ts";

/** At most this often per fetch, besides every phase change. */
const MIN_INTERVAL_MS = 500;

export type ProgressInput = ProgressEvent | { phase: "storing" };

function toProgress(e: ProgressInput): DownloadProgress {
  if (e.phase === "storing") {
    return {
      phase: "storing",
      percent: null,
      downloadedBytes: null,
      totalBytes: null,
      speed: null,
      eta: null,
    };
  }
  const percent =
    e.downloadedBytes !== null && e.totalBytes !== null && e.totalBytes > 0
      ? Math.min(100, (e.downloadedBytes / e.totalBytes) * 100)
      : null;
  return {
    phase: e.phase,
    percent,
    downloadedBytes: e.downloadedBytes,
    totalBytes: e.totalBytes,
    speed: e.speed,
    eta: e.eta,
  };
}

/**
 * A throttled progress sink for one fetch: keeps the latest value for page loads and tells every
 * replica. One write is in flight at a time; values that arrive meanwhile wait, and only the newest
 * is written next. Never throws (progress is best effort).
 */
export function createProgressPublisher(
  db: Kysely<Database>,
  key: string,
): (e: ProgressInput) => void {
  let lastPhase: string | null = null;
  let lastAt = 0;
  let writing = false;
  let waiting: DownloadProgress | null = null;
  const write = (progress: DownloadProgress) => {
    writing = true;
    void saveProgress(db, key, progress)
      .catch(() => undefined)
      .finally(() => {
        writing = false;
        const next = waiting;
        waiting = null;
        if (next !== null) write(next);
      });
  };
  return (e) => {
    const now = Date.now();
    if (e.phase === lastPhase && now - lastAt < MIN_INTERVAL_MS) return;
    lastPhase = e.phase;
    lastAt = now;
    const progress = toProgress(e);
    if (writing) waiting = progress;
    else write(progress);
  };
}
