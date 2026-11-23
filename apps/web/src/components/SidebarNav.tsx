import { Link } from "@tanstack/react-router";

import { useInfo } from "@/api/client";
import { cn } from "@/lib/utils";
import { ADMIN_ITEMS, NAV_ITEMS, type NavItem } from "@/nav";

/**
 * The side navigation below the top bar, on the page colour. Full (240px rows) or mini (a 72px
 * rail with the label under the icon), switched by the top bar's menu button.
 */
export function SidebarNav({
  isAdmin = false,
  mini = false,
}: {
  isAdmin?: boolean;
  mini?: boolean;
}) {
  const info = useInfo();
  return (
    <div className="flex h-full flex-col">
      <nav
        aria-label="Primary"
        className={cn("flex flex-1 flex-col overflow-y-auto pt-2", mini ? "px-1" : "px-3")}
      >
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} item={item} mini={mini} />
        ))}
        {isAdmin ? (
          <>
            <div className={cn("my-2 border-t border-border", mini ? "mx-3" : "mx-1")} />
            {mini ? null : (
              <p className="px-3 pt-1.5 pb-1.5 text-xs font-medium text-muted-foreground">Admin</p>
            )}
            {ADMIN_ITEMS.map((item) => (
              <NavLink key={item.to} item={item} mini={mini} />
            ))}
          </>
        ) : null}
      </nav>
      {mini ? null : (
        <p className="px-6 py-4 text-xs text-muted-foreground">
          {info.data ? `${info.data.name} v${info.data.version}` : " "}
        </p>
      )}
    </div>
  );
}

function NavLink({ item, mini }: { item: NavItem; mini: boolean }) {
  const { to, label, icon: Icon } = item;
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className={cn(
        "rounded-[10px] outline-none hover:bg-raised/60 focus-visible:ring-[3px] focus-visible:ring-ring/45 data-[status=active]:bg-raised data-[status=active]:font-medium",
        mini
          ? "flex flex-col items-center gap-1.5 px-1 pt-4 pb-3.5 text-[10px]"
          : "flex h-10 items-center gap-6 px-3 text-sm",
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      <span className={cn(mini && "max-w-full truncate")}>{label}</span>
    </Link>
  );
}
