import type { DownloadProgress } from "@uroboros/contract";
import type { ProgressEvent } from "@uroboros/ytdlp";
import type { Redis } from "ioredis";
import { progressKey, PROGRESS_TTL_S, publishDownloadEvent } from "../downloads/events.ts";

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
 * A throttled progress sink for one fetch: publishes on the events channel and keeps the latest
 * value for page loads. Never throws (progress is best effort).
 */
export function createProgressPublisher(
  valkey: Redis,
  prefix: string,
  key: string,
): (e: ProgressInput) => void {
  let lastPhase: string | null = null;
  let lastAt = 0;
  return (e) => {
    const now = Date.now();
    if (e.phase === lastPhase && now - lastAt < MIN_INTERVAL_MS) return;
    lastPhase = e.phase;
    lastAt = now;
    const progress = toProgress(e);
    void (async () => {
      await valkey.set(progressKey(prefix, key), JSON.stringify(progress), "EX", PROGRESS_TTL_S);
      await publishDownloadEvent(valkey, prefix, { kind: "progress", fetchKey: key, progress });
    })().catch(() => undefined);
  };
}
