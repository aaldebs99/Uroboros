import type {
  CooldownScope,
  RateLimitSource,
  ReplicaCheck,
  ReplicaStatus,
} from "@uroboros/contract";

import type { BadgeTone } from "@/components/ui/badge";

/** Admin › Health's words and figures (docs/health.md). */

export const head = "px-2.5 py-2.5 text-xs font-medium text-muted-foreground";
export const cell = "px-2.5 py-2 max-md:px-0 max-md:py-0.5";
export const num = `${cell} md:text-right tabular-nums`;
export const row = "border-t border-border hover:bg-raised max-md:grid max-md:gap-1 max-md:py-3";

export const REPLICA_STATUS = {
  ok: { label: "Ready", tone: "success" },
  degraded: { label: "Degraded", tone: "warning" },
  not_answering: { label: "Not answering", tone: "destructive" },
} as const satisfies Record<ReplicaStatus, { label: string; tone: BadgeTone }>;

export const CHECK_NAME = {
  storage: "storage",
} as const satisfies Record<ReplicaCheck, string>;

export const SCOPE_NAME = {
  site: "All requests",
  subtitles: "Subtitles",
} as const satisfies Record<CooldownScope, string>;

export const SOURCE_NAME = {
  download: "Download",
  link: "Link check",
  search: "Search",
  subscription: "Subscription check",
  preview: "Hover preview",
  subtitles: "Subtitles",
} as const satisfies Record<RateLimitSource, string>;

/** The viewer's own time of day, "14:05". */
export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The date and time in the browser's own time zone, the zone named, as a relative time's tooltip
 * says it: "Nov 27, 2026, 3:07:42 PM EST".
 */
export const fullTime = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "long" });

/** A cooldown's length: "45 s", "4 min", "1 h", "1 h 30 min". */
export function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/**
 * How long ago something happened, to the second, so it counts up while the page shows: "42 s
 * ago", "4 min 12 s ago", then "2 h 5 min ago" and "3 d 1 h ago". A browser clock a little ahead
 * of the server's never reads as the future.
 */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${String(seconds)} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min ${String(seconds % 60)} s ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h ${String(minutes % 60)} min ago`;
  return `${String(Math.floor(hours / 24))} d ${String(hours % 24)} h ago`;
}

const plural = (n: number, one: string) => `${String(n)} ${one}${n === 1 ? "" : "s"}`;

/** What waits on a cooldown: "4 downloads, 1 link", or "Nothing waits". */
export function waitingText(downloads: number, links: number): string {
  const parts = [
    downloads > 0 ? plural(downloads, "download") : null,
    links > 0 ? plural(links, "link") : null,
  ].filter((p) => p !== null);
  return parts.length === 0 ? "Nothing waits" : parts.join(", ");
}

/** "0.1.5 and 0.1.6", "0.1.4, 0.1.5 and 0.1.6". */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}
