import { Link, useLocation } from "@tanstack/react-router";

import { useInfo } from "@/api/client";
import { cn } from "@/lib/utils";
import { ADMIN_ITEMS, inLibrary, LIBRARY_VIEWS, NAV_ITEMS, type NavItem } from "@/nav";

const rowFocus = "outline-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45";

/**
 * The side navigation below the top bar, on the page colour. Full (15rem rows, with the library's
 * views indented under Library) or mini (a 4.5rem rail with the label under the icon), switched by
 * the top bar's menu button.
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
        {NAV_ITEMS.map((item) =>
          item.to === "/" ? (
            <LibraryLinks key={item.to} item={item} mini={mini} />
          ) : (
            <NavLink key={item.to} item={item} mini={mini} />
          ),
        )}
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

function rowClasses(mini: boolean): string {
  return cn(
    "rounded-[0.625rem] hover:bg-raised/60",
    rowFocus,
    mini
      ? "flex flex-col items-center gap-1.5 px-1 pt-4 pb-3.5 text-[0.625rem]"
      : "flex h-10 items-center gap-6 px-3 text-sm",
  );
}

function NavLink({ item, mini }: { item: NavItem; mini: boolean }) {
  const { to, label, icon: Icon } = item;
  return (
    <Link
      to={to}
      className={cn(
        rowClasses(mini),
        "data-[status=active]:bg-raised data-[status=active]:font-medium",
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      <span className={cn(mini && "max-w-full truncate")}>{label}</span>
    </Link>
  );
}

/**
 * Library and, in the full navigation, its views indented under it (Videos, Channels, Playlists).
 * The current view is the filled row; Library itself only turns medium while one of its pages is
 * open. The mini rail has no room for the views, so there Library fills on any library page.
 */
function LibraryLinks({ item, mini }: { item: NavItem; mini: boolean }) {
  const { label, icon: Icon } = item;
  const here = inLibrary(useLocation({ select: (l) => l.pathname }));
  return (
    <>
      <Link
        to="/"
        activeOptions={{ exact: true }}
        className={cn(rowClasses(mini), here && (mini ? "bg-raised font-medium" : "font-medium"))}
      >
        <Icon className="size-5 shrink-0" aria-hidden />
        <span className={cn(mini && "max-w-full truncate")}>{label}</span>
      </Link>
      {mini ? null : (
        <ul aria-label="Library views" className="grid">
          {LIBRARY_VIEWS.map((view) => (
            <li key={view.to}>
              <Link
                to={view.to}
                activeOptions={{ exact: view.to === "/" }}
                className={cn(
                  "flex h-9 items-center rounded-[0.625rem] pr-3 pl-14 text-sm text-muted-foreground hover:bg-raised/60 hover:text-foreground data-[status=active]:bg-raised data-[status=active]:font-medium data-[status=active]:text-foreground",
                  rowFocus,
                )}
              >
                {view.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
