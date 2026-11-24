import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A page's header. The navigation already says where you are (the side navigation's current row,
 * a section's views beneath it, the bottom tabs and the menu on phones), so a section's title and
 * its muted line are for screen readers only, and the page starts with its content: only the
 * page's main action shows, at the trailing edge. A page about one thing (a playlist, a
 * subscription) passes `showTitle`, since its title names that thing: then the title and line show
 * at every width, with the action beside them and a hairline under the header.
 */
export function PageHeader({
  title,
  description,
  action,
  showTitle = false,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  showTitle?: boolean;
}) {
  const hasAction = action !== undefined && action !== null;
  const heading = (
    <div className={cn("grid min-w-0 gap-1", !showTitle && "sr-only")}>
      <h1 className="text-2xl/[1.15] font-bold">{title}</h1>
      {description === undefined ? null : <p className="text-muted-foreground">{description}</p>}
    </div>
  );
  if (!showTitle) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-end justify-end gap-x-6 gap-y-3",
          !hasAction && "sr-only",
        )}
      >
        {heading}
        {action}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-3.5">
      {heading}
      {action}
    </div>
  );
}
