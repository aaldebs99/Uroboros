import { Link } from "@tanstack/react-router";
import { Download, Library, Plus, Rss, UserRound, type LucideIcon } from "lucide-react";

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
      className="flex min-w-11 flex-1 flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45 data-[status=active]:text-foreground"
    >
      <Icon className="size-[22px]" aria-hidden />
      {tab.label}
    </Link>
  );
}

/** Phones' bottom tabs: Library, Downloads, a centred "+" (Download a link), Subscriptions, You. */
export function TabBar({ onDownload }: { onDownload: () => void }) {
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(58px+env(safe-area-inset-bottom))] items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {LEFT.map((tab) => (
        <TabLink key={tab.to} tab={tab} />
      ))}
      <div className="flex flex-1 items-center justify-center">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Create"
          className="rounded-full border-[1.5px] border-foreground"
          onClick={onDownload}
        >
          <Plus className="size-[22px]" aria-hidden />
        </Button>
      </div>
      {RIGHT.map((tab) => (
        <TabLink key={tab.to} tab={tab} />
      ))}
    </nav>
  );
}
