import { Link } from "@tanstack/react-router";

import { LIBRARY_VIEWS } from "@/nav";

/**
 * The library's views as underlined tabs, on phones only: from `md` up they are rows under
 * Library in the side navigation.
 */
export function ViewTabs() {
  return (
    <nav
      aria-label="Library views"
      className="flex gap-6 overflow-x-auto overflow-y-hidden border-b border-border md:hidden"
    >
      {LIBRARY_VIEWS.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          activeOptions={{ exact: true }}
          className="-mb-px border-b-2 border-transparent py-2.5 font-medium text-muted-foreground hover:text-foreground focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none data-[status=active]:border-foreground data-[status=active]:text-foreground"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
