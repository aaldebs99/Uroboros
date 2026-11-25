import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A back link's look: a compact quiet button whose arrow lines up with the text at the left margin.
 * The negative bottom margin leaves 0.75rem to what follows in a `gap-6` section.
 */
export const backLinkClass = cn(
  buttonVariants({ variant: "quiet", size: "compact" }),
  "-mb-3 -ml-3.5 w-fit",
);

/**
 * Back to the list a detail page was opened from: a compact quiet link above the title, named after
 * the list ("← Subscriptions"). It is a router link to the list rather than `history.back()`, so it
 * works from a deep link too, and a page shows it in its error state as well. A page in a `gap-8`
 * section passes `-mb-5`. The watch page has its own (`library/WatchBack.tsx`).
 */
export function BackLink({
  to,
  children,
  className,
}: {
  to:
    | "/subscriptions"
    | "/settings/groups"
    | "/library/channels"
    | "/library/playlists"
    | "/shared";
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} className={cn(backLinkClass, className)}>
      <ArrowLeft aria-hidden /> {children}
    </Link>
  );
}
