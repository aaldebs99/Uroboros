import {
  Download,
  Library,
  Rss,
  Settings,
  Share2,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to:
    | "/"
    | "/downloads"
    | "/subscriptions"
    | "/shared"
    | "/settings"
    | "/admin/users"
    | "/admin/groups";
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
  {
    to: "/shared",
    label: "Shared",
    icon: Share2,
    blurb: "Videos and playlists shared with you, and by you.",
  },
  { to: "/settings", label: "Settings", icon: Settings, blurb: "Tune Uroboros to your setup." },
];

/** The library's views: indented under Library in the side navigation, tabs on phones. */
export const LIBRARY_VIEWS = [
  { to: "/", label: "Videos" },
  { to: "/library/channels", label: "Channels" },
  { to: "/library/playlists", label: "Playlists" },
] as const;

/** Shared's views, the same way: indented under Shared in the side navigation, tabs on phones. */
export const SHARED_VIEWS = [
  { to: "/shared", label: "With me" },
  { to: "/shared/by-me", label: "By me" },
] as const;

/** Settings' views, the same way: indented under Settings in the side navigation, tabs on phones. */
export const SETTINGS_VIEWS = [
  { to: "/settings", label: "Notifications" },
  { to: "/settings/logins", label: "Logins" },
  { to: "/settings/profiles", label: "Profiles" },
  { to: "/settings/sponsorblock", label: "SponsorBlock" },
  { to: "/settings/groups", label: "Groups" },
  { to: "/settings/tokens", label: "Tokens" },
] as const;

/** Whether `pathname` is one of Settings' views. */
export function inSettings(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

/** Whether `pathname` is one of Shared's pages (its views, a playlist shared with the person). */
export function inShared(pathname: string): boolean {
  return pathname === "/shared" || pathname.startsWith("/shared/");
}

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
    icon: UserRound,
    blurb: "Who can sign in, and what they can do.",
  },
  {
    to: "/admin/groups",
    label: "Groups",
    icon: Users,
    blurb: "Every group people made, and who runs it.",
  },
];
