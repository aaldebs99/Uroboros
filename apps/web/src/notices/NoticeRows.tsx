import type { Notice, NoticeKind } from "@uroboros/contract";
import { Download, type LucideIcon, Rss, Share2, Users } from "lucide-react";

import { relativeTime } from "@/subscriptions/format";

import { PanelLink } from "./PanelLink";
import { glyphCircle, panelRow } from "./styles";

const ICON = {
  downloads: Download,
  shares: Share2,
  subscriptions: Rss,
  groups: Users,
} as const satisfies Record<NoticeKind, LucideIcon>;

/** The notifications, newest first; those unread when the panel opened carry a dot. */
export function NoticeRows({
  notices,
  fresh,
  onNavigate,
}: {
  notices: readonly Notice[];
  /** Unread when the panel opened (opening marks them read on the server). */
  fresh: ReadonlySet<string>;
  onNavigate: () => void;
}) {
  return (
    <ul className="grid">
      {notices.map((n) => {
        const Icon = ICON[n.kind];
        const unread = !n.read || fresh.has(n.id);
        return (
          <li key={n.id}>
            <PanelLink href={n.path} onNavigate={onNavigate} className={panelRow}>
              <span className={glyphCircle}>
                <Icon aria-hidden />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="line-clamp-2 font-medium break-words">{n.title}</span>
                {n.body === null ? null : (
                  <span className="line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">
                    {n.body}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{relativeTime(n.createdAt)}</span>
              </span>
              {unread ? (
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
                  <span className="sr-only">Unread</span>
                </span>
              ) : null}
            </PanelLink>
          </li>
        );
      })}
    </ul>
  );
}
