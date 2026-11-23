import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The title, a muted line under it, and the page's main action at the trailing edge. On phones a
 * section's title and line are hidden (kept for screen readers): the bottom tabs and the menu
 * already say where you are, so the page starts with its content, and only the action shows.
 * A page about one thing (a playlist, a subscription) passes `titleOnPhone`, since its title
 * names that thing.
 */
export function PageHeader({
  title,
  description,
  action,
  titleOnPhone = false,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  titleOnPhone?: boolean;
}) {
  const hasAction = action !== undefined && action !== null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-3.5",
        !titleOnPhone && "max-md:border-b-0 max-md:pb-0",
        !titleOnPhone && !hasAction && "max-md:sr-only",
      )}
    >
      <div className={cn("grid min-w-0 gap-1", !titleOnPhone && "max-md:sr-only")}>
        <h1 className="text-2xl/[1.15] font-bold">{title}</h1>
        {description === undefined ? null : <p className="text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
