import type { HistoryLocation, RouterHistory } from "@tanstack/react-router";

import { isWatchPage } from "@/nav";

/** The page a watch page was opened from, as its back link goes there. */
export interface WatchOrigin {
  /** The page's path with its query, as it was ("/?q=cats"). */
  href: string;
  /** What the back link calls it ("Downloads", "Playlist"). */
  label: string;
  /** How many entries back in the history it is; null when only a new navigation reaches it. */
  steps: number | null;
}

/** Where a watch page opened from outside the app (a link, a notification) leads back to. */
const LIBRARY: WatchOrigin = { href: "/", label: "Library", steps: null };

/** The pages a watch page is opened from, and their names on its back link. */
const PLACES: readonly (readonly [RegExp, string])[] = [
  [/^\/$/, "Library"],
  [/^\/library\/audio$/, "Audio"],
  [/^\/library\/channels$/, "Channels"],
  [/^\/library\/channels\/[^/]+$/, "Channel"],
  [/^\/library\/playlists$/, "Playlists"],
  [/^\/library\/playlists\/[^/]+$/, "Playlist"],
  [/^\/downloads$/, "Downloads"],
  [/^\/subscriptions$/, "Subscriptions"],
  [/^\/subscriptions\/new$/, "New subscription"],
  [/^\/subscriptions\/[^/]+$/, "Subscription"],
  [/^\/shared(\/by-me)?$/, "Shared"],
  [/^\/shared\/[^/]+$/, "Shared playlist"],
  [/^\/settings(\/.*)?$/, "Settings"],
];

/** The back link's name for the page at `pathname`; plain "Back" for one without a name. */
export function placeName(pathname: string): string {
  return PLACES.find(([path]) => path.test(pathname))?.[1] ?? "Back";
}

/** Each kept history's trail: the address of every entry the tab arrived at, by its index. */
const trails = new WeakMap<RouterHistory, Map<number, string>>();

/**
 * Keeps `history`'s trail from now on, so a watch page can find the page it was opened from
 * (`watchOrigin`). An entry is noted each time the tab arrives at it, which keeps every entry
 * behind the current one right: a new entry only ever replaces the ones ahead.
 */
export function keepTrail(history: RouterHistory): RouterHistory {
  const trail = new Map<number, string>();
  trails.set(history, trail);
  const note = (location: HistoryLocation) => {
    const index: unknown = location.state.__TSR_index;
    if (typeof index === "number") trail.set(index, location.href);
  };
  note(history.location);
  history.subscribe(({ location }) => {
    note(location);
  });
  return history;
}

/**
 * The page the current watch page was opened from: the nearest entry behind it that is not a watch
 * page, past any videos played since (a queue's next, a suggestion). The Library when the trail
 * runs out first, as it does for a watch page opened from outside or reloaded.
 */
export function watchOrigin(history: RouterHistory): WatchOrigin {
  const trail = trails.get(history);
  const here: unknown = history.location.state.__TSR_index;
  if (trail === undefined || typeof here !== "number") return LIBRARY;
  for (let at = here - 1; at >= 0; at--) {
    const href = trail.get(at);
    if (href === undefined) return LIBRARY;
    const pathname = href.split(/[?#]/, 1)[0] ?? href;
    if (!isWatchPage(pathname)) return { href, label: placeName(pathname), steps: here - at };
  }
  return LIBRARY;
}
