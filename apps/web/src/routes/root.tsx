import type { Me } from "@uroboros/contract";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Menu, Plus, Search } from "lucide-react";
import { useState } from "react";

import { Brand } from "@/components/Brand";
import { DownloadDialog } from "@/components/DownloadDialog";
import { NavDrawer } from "@/components/NavDrawer";
import { SearchBar } from "@/components/SearchBar";
import { SidebarNav } from "@/components/SidebarNav";
import { TabBar } from "@/components/TabBar";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { AuthGate } from "@/auth/AuthGate";
import { UserMenu } from "@/auth/UserMenu";
import { cn } from "@/lib/utils";
import { isWatchPage } from "@/nav";
import { usePushSync } from "@/push/usePushSync";

import { readMini, storeMini } from "./miniNav";

/** The whole app sits behind sign-in: the gate shows the sign-in page until someone is. */
export function RootLayout() {
  return <AuthGate>{(me) => <Shell me={me} />}</AuthGate>;
}

/**
 * The app shell, on the page colour throughout. From `md` up: a 56px top bar (menu, brand,
 * search, "+ Create", avatar) over the side navigation, full or mini; a watch page gives the
 * navigation's room to the player and opens it as a drawer instead. Below `md`: a slim bar and
 * the bottom tabs. It also mends this browser's push subscription once per launch.
 */
function Shell({ me }: { me: Me }) {
  const [mini, setMini] = useState(readMini);
  const [downloading, setDownloading] = useState(false);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const watching = isWatchPage(pathname);
  const [drawer, setDrawer] = useState(false);
  // Any navigation closes the drawer (a link in it, back or forward), adjusted during render.
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setDrawer(false);
  }
  const isAdmin = me.role === "admin";
  usePushSync();
  const openDownload = () => {
    setDownloading(true);
  };
  return (
    <div
      className={cn(
        "page-glow min-h-dvh pt-12 pb-[calc(58px+env(safe-area-inset-bottom))] md:pt-14 md:pb-0",
        watching ? null : mini ? "md:pl-[72px]" : "md:pl-60",
      )}
    >
      {searching ? (
        <div className="fixed inset-x-0 top-12 z-30 bg-background px-3 pb-2 md:hidden">
          <SearchBar />
        </div>
      ) : null}
      <header className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 bg-background px-3 md:h-14 md:gap-4 md:px-4">
        <div className="flex shrink-0 items-center gap-2 md:w-52">
          {watching ? (
            <NavDrawer open={drawer} onOpenChange={setDrawer} isAdmin={isAdmin} />
          ) : (
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
          )}
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
          {/* Downloading a link is the one thing to create, so Create opens its dialog directly;
              it becomes a menu once there is more than one. */}
          <Button
            variant="icon"
            className="hidden h-9 rounded-full pr-4 pl-3 md:inline-flex"
            onClick={openDownload}
          >
            <Plus className="size-5" aria-hidden />
            Create
          </Button>
          <UserMenu
            me={me}
            onOpenSettings={() => {
              void navigate({ to: "/settings" });
            }}
          />
        </div>
      </header>
      {watching ? null : (
        <aside
          className={cn(
            "fixed top-14 bottom-0 left-0 z-20 hidden bg-background md:block",
            mini ? "w-[72px]" : "w-60",
          )}
        >
          <SidebarNav isAdmin={isAdmin} mini={mini} />
        </aside>
      )}
      {/* A watch page keeps YouTube's narrower 24px margins, giving the player the room. */}
      <main className={cn("px-4 py-6", watching ? "md:p-6" : "md:px-8 md:py-8")}>
        <Outlet />
      </main>
      <TabBar onDownload={openDownload} />
      <DownloadDialog open={downloading} onOpenChange={setDownloading} />
      <Toaster />
    </div>
  );
}
