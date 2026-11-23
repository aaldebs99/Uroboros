import { Download, Library, Rss, Settings, Users, type LucideIcon } from "lucide-react";

export type NavItem = {
  to: "/" | "/downloads" | "/subscriptions" | "/settings" | "/admin/users";
  label: string;
  icon: LucideIcon;
  blurb: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    to: "/",
    label: "Library",
    icon: Library,
    blurb: "Everything you have downloaded, in one place.",
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

/** Shown to admins only, under an "Admin" heading. */
export const ADMIN_ITEMS: readonly NavItem[] = [
  {
    to: "/admin/users",
    label: "Users",
    icon: Users,
    blurb: "Who can sign in, and what they can do.",
  },
];
