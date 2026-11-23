import {
  Download,
  Library,
  Rss,
  Settings,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to:
    | "/"
    | "/downloads"
    | "/subscriptions"
    | "/settings"
    | "/admin/users"
    | "/admin/format-profiles";
  label: string;
  icon: LucideIcon;
  blurb: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: "/",
    label: "Library",
    icon: Library,
    blurb: "Your downloads: videos, channels and playlists.",
  },
  { to: "/downloads", label: "Downloads", icon: Download, blurb: "Queue, progress and history." },
  {
    to: "/subscriptions",
    label: "Subscriptions",
    icon: Rss,
    blurb: "Channels and playlists, kept up to date.",
  },
  { to: "/settings", label: "Settings", icon: Settings, blurb: "Tune Uroboros to your setup." },
];

/** The library's views: indented under Library in the side navigation, tabs on phones. */
export const LIBRARY_VIEWS = [
  { to: "/", label: "Videos" },
  { to: "/library/channels", label: "Channels" },
  { to: "/library/playlists", label: "Playlists" },
] as const;

/** Whether `pathname` is one of the library's pages (its views, a channel, a playlist, a video). */
export function inLibrary(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/library/");
}

/**
 * Whether `pathname` is a video's watch page (`/library/$entryId`), where the side navigation
 * steps aside for the player, as on YouTube.
 */
export function isWatchPage(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  return (
    parts.length === 2 &&
    parts[0] === "library" &&
    parts[1] !== "channels" &&
    parts[1] !== "playlists"
  );
}

/** Shown to admins only, under an "Admin" heading. */
export const ADMIN_ITEMS: readonly NavItem[] = [
  {
    to: "/admin/users",
    label: "Users",
    icon: Users,
    blurb: "Who can sign in, and what they can do.",
  },
  {
    to: "/admin/format-profiles",
    label: "Format profiles",
    icon: SlidersHorizontal,
    blurb: "The presets people pick from when downloading.",
  },
];
