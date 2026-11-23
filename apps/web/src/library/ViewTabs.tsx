import { Link } from "@tanstack/react-router";

const TABS = [
  { to: "/", label: "Videos" },
  { to: "/library/channels", label: "Channels" },
  { to: "/library/playlists", label: "Playlists" },
] as const;

/** The library's views: links between routes, underlined when current. */
export function ViewTabs() {
  return (
    <nav aria-label="Library views" className="flex gap-6 overflow-x-auto border-b border-border">
      {TABS.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          activeOptions={{ exact: true }}
          className="-mb-px border-b-2 border-transparent py-2.5 font-medium text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/45 focus-visible:outline-none data-[status=active]:border-foreground data-[status=active]:text-foreground"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
