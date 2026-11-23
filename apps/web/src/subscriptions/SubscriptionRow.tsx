import type { Subscription } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";
import { EllipsisVertical, Pause, Play, RefreshCw, Trash2 } from "lucide-react";

import { Avatar } from "@/components/Avatar";
import { SubscriptionBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ResponsiveMenu, type MenuAction } from "@/components/ui/responsive-menu";

import { scheduleLabel, sourceLabel } from "./format";

/** What a row's menu does; the page owns the requests and the confirmation. */
export interface RowActions {
  check: (sub: Subscription) => void;
  setEnabled: (sub: Subscription, enabled: boolean) => void;
  unsubscribe: (sub: Subscription) => void;
}

function menuFor(sub: Subscription, actions: RowActions): MenuAction[] {
  return [
    ...(sub.enabled
      ? [
          {
            label: "Check now",
            icon: RefreshCw,
            onSelect: () => {
              actions.check(sub);
            },
          },
          {
            label: "Pause",
            icon: Pause,
            onSelect: () => {
              actions.setEnabled(sub, false);
            },
          },
        ]
      : [
          {
            label: "Resume",
            icon: Play,
            onSelect: () => {
              actions.setEnabled(sub, true);
            },
          },
        ]),
    {
      label: "Unsubscribe",
      icon: Trash2,
      destructive: true,
      onSelect: () => {
        actions.unsubscribe(sub);
      },
    },
  ];
}

/** One subscription: what it follows, how often, its state, and a ⋮ menu. */
export function SubscriptionRow({ sub, actions }: { sub: Subscription; actions: RowActions }) {
  const title = sub.title ?? sub.url;
  return (
    <li className="flex items-center gap-3 rounded-[0.75rem] p-3 hover:bg-raised">
      <Avatar name={title} className="size-12 shrink-0 text-base" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/subscriptions/$subscriptionId"
            params={{ subscriptionId: sub.id }}
            className="truncate text-base font-medium hover:underline focus-visible:rounded-[0.25rem] focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none"
          >
            {title}
          </Link>
          <SubscriptionBadge sub={sub} />
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {sourceLabel(sub)} · {sub.profileName}
        </p>
        <p className="truncate text-xs text-muted-foreground">{scheduleLabel(sub)}</p>
      </div>
      <ResponsiveMenu
        title={title}
        actions={menuFor(sub, actions)}
        trigger={
          <Button variant="ghost" size="icon" aria-label={`Actions for ${title}`}>
            <EllipsisVertical className="size-5" aria-hidden />
          </Button>
        }
      />
    </li>
  );
}
