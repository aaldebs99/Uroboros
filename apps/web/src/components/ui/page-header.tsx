import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The title, a muted line under it, and the page's main action at the trailing edge. On phones a
 * section's title and line are hidden (kept for screen readers): the bottom tabs and the menu
 * already say where you are, so the page starts with its content, and only the action shows.
 * A page about one thing (a playlist, a subscription) passes `titleOnPhone`, since its title
 * names that thing. A section whose name the navigation shows beside its own view tabs (the
 * library's views, Shared) passes `hideTitle`: the title is then for screen readers at every width.
 */
export function PageHeader({
  title,
  description,
  action,
  titleOnPhone = false,
  hideTitle = false,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  titleOnPhone?: boolean;
  hideTitle?: boolean;
}) {
  const hasAction = action !== undefined && action !== null;
  // Literal class names, so Tailwind sees them: hidden at every width, below md only, or never.
  const hidden = hideTitle ? "sr-only" : titleOnPhone ? null : "max-md:sr-only";
  const noRule = hideTitle
    ? "border-b-0 pb-0"
    : titleOnPhone
      ? null
      : "max-md:border-b-0 max-md:pb-0";
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-3.5",
        noRule,
        // With the title gone the action keeps the trailing edge.
        hideTitle && "justify-end",
        !hasAction && hidden,
      )}
    >
      <div className={cn("grid min-w-0 gap-1", hidden)}>
        <h1 className="text-2xl/[1.15] font-bold">{title}</h1>
        {description === undefined ? null : <p className="text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
