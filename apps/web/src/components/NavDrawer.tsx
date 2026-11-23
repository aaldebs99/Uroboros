import { Menu } from "lucide-react";

import { Brand } from "@/components/Brand";
import { SidebarNav } from "@/components/SidebarNav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/**
 * The side navigation as a drawer over the page: the menu on phones, and on the watch page, which
 * gives the navigation's room to the player (YouTube's watch page does the same). It renders the
 * top bar's menu button, which opens it (and gets the focus back when it closes), and carries its
 * own menu button and brand where the top bar's sit, so it reads as the navigation sliding in.
 * `triggerClassName` limits where that button shows (phones only, where the side navigation is
 * there from `md` up).
 */
export function NavDrawer({
  open,
  onOpenChange,
  isAdmin,
  triggerClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  triggerClassName?: string | undefined;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={triggerClassName}
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        hideClose
        aria-describedby={undefined}
        className="w-60 gap-0 border-r-0 sm:max-w-none"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex h-12 shrink-0 items-center gap-2 px-3 md:h-14 md:px-4">
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close navigation">
              <Menu className="size-5" />
            </Button>
          </SheetClose>
          <Brand />
        </div>
        <div className="min-h-0 flex-1">
          <SidebarNav isAdmin={isAdmin} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
