import { Link, useLocation } from "@tanstack/react-router";

import { useInfo } from "@/api/client";
import { cn } from "@/lib/utils";
import {
  ADMIN_ITEMS,
  inLibrary,
  inSettings,
  LIBRARY_VIEWS,
  NAV_ITEMS,
  SETTINGS_VIEWS,
  type NavItem,
} from "@/nav";

const rowFocus = "outline-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45";

/** A navigation item whose views are indented under it, and the pages that count as its own. */
interface Section {
  listLabel: string;
  views: readonly {
    to: (typeof LIBRARY_VIEWS | typeof SETTINGS_VIEWS)[number]["to"];
    label: string;
  }[];
  here: (pathname: string) => boolean;
}

const SECTIONS: Partial<Record<NavItem["to"], Section>> = {
  "/": { listLabel: "Library views", views: LIBRARY_VIEWS, here: inLibrary },
  "/settings": { listLabel: "Settings views", views: SETTINGS_VIEWS, here: inSettings },
};

/**
 * The side navigation below the top bar, on the page colour. Full (15rem rows, with the library's
 * views indented under Library and Settings' under Settings) or mini (a 4.5rem rail with the label
 * under the icon), switched by the top bar's menu button.
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
        {NAV_ITEMS.map((item) => {
          const section = SECTIONS[item.to];
          return section === undefined ? (
            <NavLink key={item.to} item={item} mini={mini} />
          ) : (
            <SectionLinks key={item.to} item={item} section={section} mini={mini} />
          );
        })}
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
 * A section (Library, Settings) and, in the full navigation, its views indented under it (Videos,
 * Channels, Playlists; Notifications, Logins). The current view is the filled row; the section
 * itself only turns medium while one of its pages is open. The mini rail has no room for the
 * views, so there the section fills on any of its pages.
 */
function SectionLinks({ item, section, mini }: { item: NavItem; section: Section; mini: boolean }) {
  const { to, label, icon: Icon } = item;
  const here = section.here(useLocation({ select: (l) => l.pathname }));
  return (
    <>
      <Link
        to={to}
        activeOptions={{ exact: true }}
        className={cn(rowClasses(mini), here && (mini ? "bg-raised font-medium" : "font-medium"))}
      >
        <Icon className="size-5 shrink-0" aria-hidden />
        <span className={cn(mini && "max-w-full truncate")}>{label}</span>
      </Link>
      {mini ? null : (
        <ul aria-label={section.listLabel} className="grid">
          {section.views.map((view) => (
            <li key={view.to}>
              <Link
                to={view.to}
                activeOptions={{ exact: true }}
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
