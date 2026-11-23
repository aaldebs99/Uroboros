import { Link } from "@tanstack/react-router";

const TABS = [
  { to: "/shared", label: "With me" },
  { to: "/shared/by-me", label: "By me" },
] as const;

/** Shared's two views as underlined tabs. */
export function SharedTabs() {
  return (
    <nav aria-label="Shared views" className="flex gap-6 border-b border-border">
      {TABS.map((t) => (
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
