import { useNavigate } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";

/**
 * A real link to a path in the app (so it opens in a new tab with a modifier or the middle button)
 * that a plain click follows in place, then reports through `onNavigate` (closing the panel).
 */
export function PanelLink({
  href,
  onNavigate,
  className,
  children,
}: {
  href: string;
  onNavigate: () => void;
  className?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onNavigate();
    void navigate({ href });
  };
  return (
    <a href={href} onClick={follow} className={className}>
      {children}
    </a>
  );
}
