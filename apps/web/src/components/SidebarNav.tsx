import { Link } from "@tanstack/react-router";

import { useInfo } from "@/api/client";
import { ADMIN_ITEMS, NAV_ITEMS, type NavItem } from "@/nav";

type SidebarNavProps = {
  label: string;
  /** Shows the Admin section. */
  isAdmin?: boolean;
  /** Called after a link is followed, so the mobile sheet can close itself. */
  onNavigate?: () => void;
};

/**
 * Primary navigation and the server version, below the top bar. Navy in both themes, like the
 * logo tile.
 */
export function SidebarNav({ label, isAdmin = false, onNavigate }: SidebarNavProps) {
  const info = useInfo();
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <nav aria-label={label} className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pt-5">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}
        {isAdmin ? (
          <>
            <p className="mt-6 mb-1 px-3 text-xs font-medium tracking-wide text-sidebar-foreground/50 uppercase">
              Admin
            </p>
            {ADMIN_ITEMS.map((item) => (
              <NavLink key={item.to} item={item} onNavigate={onNavigate} />
            ))}
          </>
        ) : null}
      </nav>
      <div className="border-t border-sidebar-border px-5 py-4 text-xs text-sidebar-foreground/50">
        {info.data ? `${info.data.name} v${info.data.version}` : " "}
      </div>
    </div>
  );
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: (() => void) | undefined }) {
  const { to, label: text, icon: Icon } = item;
  return (
    <Link
      to={to}
      activeOptions={{ exact: true }}
      onClick={onNavigate}
      className="group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground"
    >
      <span className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-primary opacity-0 shadow-[0_0_10px_var(--sidebar-primary)] group-data-[status=active]:opacity-100" />
      <Icon className="size-[1.15rem] group-data-[status=active]:text-sidebar-primary" />
      {text}
    </Link>
  );
}
