import type { Me } from "@uroboros/contract";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";

import { Brand } from "@/components/Brand";
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
 * The app shell: a full-width top bar (brand on the left; the theme toggle and the account menu
 * on the right), and below it a fixed sidebar from `md` up or a sheet drawer under that. It also
 * mends this browser's push subscription once per launch.
 */
function Shell({ me }: { me: Me }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const isAdmin = me.role === "admin";
  usePushSync();
  return (
    <div className="page-glow min-h-dvh pt-14 md:pl-64">
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur md:px-5">
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
            <div className="bg-sidebar px-5 pt-5 pb-2">
              <Brand />
            </div>
            <SidebarNav
              label="Mobile"
              isAdmin={isAdmin}
              onNavigate={() => {
                setMenuOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>
        <Brand />
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <UserMenu
            me={me}
            onOpenAccount={() => {
              void navigate({ to: "/account" });
            }}
          />
        </div>
      </header>
      <aside className="fixed top-14 bottom-0 left-0 z-20 hidden w-64 border-r border-sidebar-border md:block">
        <SidebarNav label="Primary" isAdmin={isAdmin} />
      </aside>
      <main className="px-4 py-8 md:px-8 md:py-10">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
