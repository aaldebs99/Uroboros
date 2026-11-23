import type { Me } from "@uroboros/contract";
import { Outlet } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";

import { Brand } from "@/components/Brand";
import { HealthBadge } from "@/components/HealthBadge";
import { SidebarNav } from "@/components/SidebarNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { AuthGate } from "@/auth/AuthGate";
import { UserMenu } from "@/auth/UserMenu";
import { usePushSync } from "@/push/usePushSync";

/** The whole app sits behind sign-in: the gate shows the sign-in page until someone is. */
export function RootLayout() {
  return <AuthGate>{(me) => <Shell me={me} />}</AuthGate>;
}

/**
 * The app shell: fixed sidebar from `md` up, a sheet drawer below it, header with health, theme
 * and the account menu. It also mends this browser's push subscription once per launch.
 */
function Shell({ me }: { me: Me }) {
  const [menuOpen, setMenuOpen] = useState(false);
  usePushSync();
  return (
    <div className="page-glow min-h-dvh md:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-sidebar-border md:block">
        <SidebarNav label="Primary" />
      </aside>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur md:px-8">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-64 gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Move between sections of Uroboros.
              </SheetDescription>
              <SidebarNav
                label="Mobile"
                onNavigate={() => {
                  setMenuOpen(false);
                }}
              />
            </SheetContent>
          </Sheet>
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <HealthBadge />
            <ThemeToggle />
            <UserMenu me={me} />
          </div>
        </header>
        <main className="flex-1 px-4 py-8 md:px-8 md:py-10">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
