import { Link } from "@tanstack/react-router";
import { Download, Library, Plus, Rss, UserRound, type LucideIcon } from "lucide-react";

import { AddMenu } from "@/components/AddMenu";
import { Button } from "@/components/ui/button";

type Tab = {
  to: "/" | "/downloads" | "/subscriptions" | "/account";
  label: string;
  icon: LucideIcon;
};

const LEFT: readonly Tab[] = [
  { to: "/", label: "Library", icon: Library },
  { to: "/downloads", label: "Downloads", icon: Download },
];
const RIGHT: readonly Tab[] = [
  { to: "/subscriptions", label: "Subscriptions", icon: Rss },
  { to: "/account", label: "You", icon: UserRound },
];

function TabLink({ tab }: { tab: Tab }) {
  const Icon = tab.icon;
  return (
    <Link
      to={tab.to}
      activeOptions={{ exact: tab.to === "/" }}
      className="flex min-w-11 flex-1 flex-col items-center justify-center gap-1 text-[0.625rem] text-muted-foreground outline-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 data-[status=active]:text-foreground"
    >
      <Icon className="size-5.5" aria-hidden />
      {tab.label}
    </Link>
  );
}

/**
 * Phones' bottom tabs: Library, Downloads, a centred "+" (the Add sheet: Download or Upload),
 * Subscriptions, You.
 */
export function TabBar({ onDownload, onUpload }: { onDownload: () => void; onUpload: () => void }) {
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(3.625rem+env(safe-area-inset-bottom))] items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {LEFT.map((tab) => (
        <TabLink key={tab.to} tab={tab} />
      ))}
      <div className="flex flex-1 items-center justify-center">
        <AddMenu
          onDownload={onDownload}
          onUpload={onUpload}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Add"
              className="rounded-full border-[0.09375rem] border-foreground"
            >
              <Plus className="size-5.5" aria-hidden />
            </Button>
          }
        />
      </div>
      {RIGHT.map((tab) => (
        <TabLink key={tab.to} tab={tab} />
      ))}
    </nav>
  );
}
