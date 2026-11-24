import type { ReactElement, ReactNode } from "react";

import { DESKTOP_QUERY, useMediaQuery } from "@/lib/media";

import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "./sheet";

/**
 * A panel of anything from a trigger: a popover from `md` up, scrolling inside itself, and below
 * it the phone's bottom sheet with its grab handle. `ResponsiveMenu`'s split, for content rather
 * than actions. `trigger` must be a single element that accepts a ref (a `Button`).
 */
export function ResponsivePanel({
  title,
  trigger,
  open,
  onOpenChange,
  children,
}: {
  /** Names the panel for screen readers. */
  title: string;
  trigger: ReactElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  if (desktop) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="end"
          aria-label={title}
          className="max-h-[min(36rem,calc(100dvh-5rem))] w-[min(25rem,calc(100vw-2rem))] overflow-y-auto p-0"
        >
          {children}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" hideClose className="max-h-[85dvh] gap-0 overflow-y-auto py-2">
        <span aria-hidden className="mx-auto mb-1 h-1 w-9 shrink-0 rounded-full bg-border" />
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{title}</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}
