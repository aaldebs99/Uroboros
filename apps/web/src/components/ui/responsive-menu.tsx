import type { LucideIcon } from "lucide-react";
import { type ReactElement, useRef, useState } from "react";

import { DESKTOP_QUERY, useMediaQuery } from "@/lib/media";
import { cn } from "@/lib/utils";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "./sheet";

export type MenuAction = {
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
} & (
  | { onSelect: () => void; href?: never }
  | { /** A file to save: rendered as a real `<a download>`. */ href: string; onSelect?: never }
);

const sheetRow =
  "flex h-12 w-full items-center gap-4 px-5 text-left text-sm outline-none hover:bg-raised focus-visible:bg-raised";

/**
 * An action menu: a dropdown from `md` up, and below it a bottom sheet with 48px rows.
 * `trigger` must be a single element that accepts a ref (a `Button`).
 */
export function ResponsiveMenu({
  title,
  trigger,
  actions,
  align = "end",
}: {
  /** Names the menu for screen readers (the sheet's title). */
  title: string;
  trigger: ReactElement;
  actions: readonly MenuAction[];
  align?: "start" | "end";
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [open, setOpen] = useState(false);
  /** Set when an action was picked: it may open a dialog, so focus mustn't return to the trigger. */
  const picked = useRef(false);
  const keepFocus = (event: Event) => {
    if (picked.current) event.preventDefault();
    picked.current = false;
  };
  const pick = (onSelect: () => void) => () => {
    picked.current = true;
    onSelect();
  };
  if (desktop) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} aria-label={title} onCloseAutoFocus={keepFocus}>
          {actions.map(({ label, icon: Icon, onSelect, href, destructive = false }) =>
            href === undefined ? (
              <DropdownMenuItem key={label} destructive={destructive} onSelect={pick(onSelect)}>
                <Icon aria-hidden />
                {label}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem key={label} destructive={destructive} asChild>
                <a href={href} download>
                  <Icon aria-hidden />
                  {label}
                </a>
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" hideClose className="gap-0 py-2" onCloseAutoFocus={keepFocus}>
        <span aria-hidden className="mx-auto mb-1 h-1 w-9 rounded-full bg-border" />
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{title}</SheetDescription>
        <ul className="grid">
          {actions.map(({ label, icon: Icon, onSelect, href, destructive = false }) => (
            <li key={label}>
              {href === undefined ? (
                <button
                  type="button"
                  className={cn(sheetRow, destructive && "text-destructive")}
                  onClick={() => {
                    setOpen(false);
                    pick(onSelect)();
                  }}
                >
                  <Icon className="size-[22px]" aria-hidden />
                  {label}
                </button>
              ) : (
                <a
                  href={href}
                  download
                  className={cn(sheetRow, destructive && "text-destructive")}
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  <Icon className="size-[22px]" aria-hidden />
                  {label}
                </a>
              )}
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
