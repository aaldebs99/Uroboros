import { useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { backLinkClass } from "@/components/ui/back-link";

import { watchOrigin } from "./watchOrigin";

/**
 * A watch page's back link (the design system's rule 12): to the page the video was opened from,
 * named after it ("← Downloads"). It goes there as the browser's Back would, past any videos played
 * since, so the page comes back with its search and filters as they were. A watch page opened from
 * outside the app (a link, a notification) leads to the Library instead. A modified click opens the
 * page's address as any link does.
 */
export function WatchBack() {
  const router = useRouter();
  const origin = watchOrigin(router.history);
  return (
    <a
      href={origin.href}
      className={backLinkClass}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        // Asked again: videos played since this rendered moved the history on.
        const now = watchOrigin(router.history);
        if (now.steps === null) void router.navigate({ href: now.href });
        else router.history.go(-now.steps);
      }}
    >
      <ArrowLeft aria-hidden /> {origin.label}
    </a>
  );
}
