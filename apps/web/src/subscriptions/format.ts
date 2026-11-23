import type { Subscription } from "@uroboros/contract";

const PRESET_LABELS: Record<number, string> = {
  60: "Every hour",
  180: "Every 3 hours",
  360: "Every 6 hours",
  720: "Every 12 hours",
  1440: "Every day",
  10080: "Every week",
};

/** "Every 6 hours"; an interval that is no preset is said in hours or minutes. */
export function intervalLabel(minutes: number): string {
  const preset = PRESET_LABELS[minutes];
  if (preset !== undefined) return preset;
  return minutes % 60 === 0
    ? `Every ${String(minutes / 60)} hours`
    : `Every ${String(minutes)} minutes`;
}

/** "Channel · Videos, Live" or "Playlist". */
export function sourceLabel(sub: Pick<Subscription, "kind" | "feeds">): string {
  return sub.kind === "playlist"
    ? "Playlist"
    : `Channel · ${sub.feeds.map((f) => f.name).join(", ")}`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "2 hours ago", "in 4 hours": the nearest unit, minutes up to days. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return relative.format(0, "minute");
}

/** "every 6 hours · checked 2 hours ago" (or "not checked yet"). */
export function scheduleLabel(
  sub: Pick<Subscription, "intervalMinutes" | "lastCheckedAt">,
): string {
  const every = intervalLabel(sub.intervalMinutes).toLowerCase();
  return sub.lastCheckedAt === null
    ? `${every} · not checked yet`
    : `${every} · checked ${relativeTime(sub.lastCheckedAt)}`;
}
