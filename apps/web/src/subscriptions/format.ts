import type { CheckSchedule, Subscription } from "@uroboros/contract";

/** "Every 6 hours", "Every day", "Every 90 minutes": the largest unit that divides it. */
export function intervalLabel(minutes: number): string {
  const say = (n: number, unit: string) =>
    n === 1 ? `Every ${unit}` : `Every ${String(n)} ${unit}s`;
  if (minutes === 10080) return "Every week";
  if (minutes % 1440 === 0) return say(minutes / 1440, "day");
  if (minutes % 60 === 0) return say(minutes / 60, "hour");
  return say(minutes, "minute");
}

/** "every 6 hours", "on cron 0 9 * * 1 (Europe/Berlin)", or "manual" (only when asked). */
function cadence(schedule: CheckSchedule): string {
  switch (schedule.kind) {
    case "interval":
      return intervalLabel(schedule.minutes).toLowerCase();
    case "cron":
      return `on cron ${schedule.expression} (${schedule.timezone})`;
    case "manual":
      return "manual";
  }
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
export function scheduleLabel(sub: Pick<Subscription, "schedule" | "lastCheckedAt">): string {
  const every = cadence(sub.schedule);
  return sub.lastCheckedAt === null
    ? `${every} · not checked yet`
    : `${every} · checked ${relativeTime(sub.lastCheckedAt)}`;
}
