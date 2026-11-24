import { Link } from "@tanstack/react-router";

/** A tab is a route of its own (as `nav.ts` lists them): add a page's views here. */
export interface RouteTab {
  to: "/shared" | "/shared/by-me" | "/settings" | "/settings/logins";
  label: string;
}

/**
 * A page's views as underlined tabs, each a link to its own route (so a view has a URL): muted
 * text at 500, the current one in the foreground over a heavier underline on the hairline.
 */
export function RouteTabs({ label, tabs }: { label: string; tabs: readonly RouteTab[] }) {
  return (
    <nav aria-label={label} className="flex gap-6 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          activeOptions={{ exact: true }}
          className="-mb-px shrink-0 border-b-2 border-transparent py-2.5 font-medium text-muted-foreground hover:text-foreground focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none data-[status=active]:border-foreground data-[status=active]:text-foreground"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
