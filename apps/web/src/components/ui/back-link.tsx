import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Back to the list a detail page was opened from: a compact quiet link above the title, its arrow
 * lined up with the text at the left margin, named after the list ("← Subscriptions"). It is a
 * router link to the list rather than `history.back()`, so it works from a deep link too, and a
 * page shows it in its error state as well. The negative bottom margin leaves 0.75rem to the title
 * in a `gap-6` section; a page in a `gap-8` one passes `-mb-5`.
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
    <Link
      to={to}
      className={cn(
        buttonVariants({ variant: "quiet", size: "compact" }),
        "-mb-3 -ml-3.5 w-fit",
        className,
      )}
    >
      <ArrowLeft aria-hidden /> {children}
    </Link>
  );
}
