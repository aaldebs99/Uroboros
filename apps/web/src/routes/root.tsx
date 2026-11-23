import type { Me } from "@uroboros/contract";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { Download, Menu, Plus, Search } from "lucide-react";
import { useState } from "react";

import { Brand } from "@/components/Brand";
import { DownloadDialog } from "@/components/DownloadDialog";
import { SearchBar } from "@/components/SearchBar";
import { SidebarNav } from "@/components/SidebarNav";
import { TabBar } from "@/components/TabBar";
import { Button } from "@/components/ui/button";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { Toaster } from "@/components/ui/sonner";
import { AuthGate } from "@/auth/AuthGate";
import { UserMenu } from "@/auth/UserMenu";
import { cn } from "@/lib/utils";
import { usePushSync } from "@/push/usePushSync";

import { readMini, storeMini } from "./miniNav";

/** The whole app sits behind sign-in: the gate shows the sign-in page until someone is. */
export function RootLayout() {
  return <AuthGate>{(me) => <Shell me={me} />}</AuthGate>;
}

/**
 * The app shell, on the page colour throughout. From `md` up: a 56px top bar (menu, brand,
 * search, "+ Create", avatar) over the side navigation, full or mini. Below `md`: a slim bar and
 * the bottom tabs. It also mends this browser's push subscription once per launch.
 */
function Shell({ me }: { me: Me }) {
  const [mini, setMini] = useState(readMini);
  const [downloading, setDownloading] = useState(false);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();
  const isAdmin = me.role === "admin";
  usePushSync();
  const openDownload = () => {
    setDownloading(true);
  };
  return (
    <div
      className={cn(
        "page-glow min-h-dvh pt-12 pb-[calc(58px+env(safe-area-inset-bottom))] md:pt-14 md:pb-0",
        mini ? "md:pl-[72px]" : "md:pl-60",
      )}
    >
      {searching ? (
        <div className="fixed inset-x-0 top-12 z-30 bg-background px-3 pb-2 md:hidden">
          <SearchBar />
        </div>
      ) : null}
      <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 bg-background px-3 md:h-14 md:gap-4 md:px-4">
        <div className="flex shrink-0 items-center gap-2 md:w-52">
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            aria-label={mini ? "Expand navigation" : "Collapse navigation"}
            aria-pressed={mini}
            onClick={() => {
              setMini(!mini);
              storeMini(!mini);
            }}
          >
            <Menu className="size-5" />
          </Button>
          <Brand />
        </div>
        <div className="hidden flex-1 justify-center md:flex">
          <SearchBar />
        </div>
        <div className="ml-auto flex items-center gap-1 md:ml-0 md:gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open search"
            aria-expanded={searching}
            onClick={() => {
              setSearching(!searching);
            }}
          >
            <Search className="size-5" />
          </Button>
          <span className="hidden md:block">
            <ResponsiveMenu
              title="Create"
              actions={[{ label: "Download a link", icon: Download, onSelect: openDownload }]}
              trigger={
                <Button variant="icon" className="h-9 rounded-full pr-4 pl-3" aria-label="Create">
                  <Plus className="size-5" />
                  Create
                </Button>
              }
            />
          </span>
          <UserMenu
            me={me}
            onOpenSettings={() => {
              void navigate({ to: "/settings" });
            }}
          />
        </div>
      </header>
      <aside
        className={cn(
          "fixed top-14 bottom-0 left-0 z-20 hidden bg-background md:block",
          mini ? "w-[72px]" : "w-60",
        )}
      >
        <SidebarNav isAdmin={isAdmin} mini={mini} />
      </aside>
      <main className="px-4 py-6 md:px-8 md:py-8">
        <Outlet />
      </main>
      <TabBar onDownload={openDownload} />
      <DownloadDialog open={downloading} onOpenChange={setDownloading} />
      <Toaster />
    </div>
  );
}
