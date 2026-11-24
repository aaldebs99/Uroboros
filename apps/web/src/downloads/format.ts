import type { DownloadProgress } from "@uroboros/contract";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${UNITS[unit] ?? "B"}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${String(h)}:${String(m).padStart(2, "0")}:${rest}` : `${String(m)}:${rest}`;
}

/** "12.4 MB/s · 38 s left", from whatever the progress knows. */
export function progressDetail(progress: DownloadProgress | null): string {
  if (progress === null) return "";
  return [
    progress.speed === null ? null : `${formatBytes(progress.speed)}/s`,
    progress.eta === null ? null : `${formatDuration(progress.eta)} left`,
  ]
    .filter(Boolean)
    .join(" · ");
}
