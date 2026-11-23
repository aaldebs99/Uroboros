import type { SubscriptionItem } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";

import { errorText } from "@/api/client";
import { useSubscriptionItems } from "@/api/subscriptions";
import { ItemOutcomeBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";

import { relativeTime } from "./format";

function ItemTitle({ item }: { item: SubscriptionItem }) {
  const title = item.title ?? item.videoId;
  return item.entryId === null ? (
    <span className="truncate font-medium">{title}</span>
  ) : (
    <Link
      to="/library/$entryId"
      params={{ entryId: item.entryId }}
      className="truncate font-medium hover:underline focus-visible:rounded-[4px] focus-visible:ring-[3px] focus-visible:ring-ring/45 focus-visible:outline-none"
    >
      {title}
    </Link>
  );
}

/** What the subscription saw, newest first: each video's outcome and why. */
export function ActivityList({
  subscriptionId,
  lastCheckedAt,
}: {
  subscriptionId: string;
  lastCheckedAt: string | null;
}) {
  const items = useSubscriptionItems(subscriptionId, lastCheckedAt);
  const list = items.data?.pages.flatMap((p) => p.items) ?? [];
  if (items.isError) return <p className="text-destructive">{errorText(items.error)}</p>;
  if (!items.isSuccess) return null;
  if (list.length === 0) {
    return <p className="text-muted-foreground">Nothing yet: the first check has not run.</p>;
  }
  return (
    <div className="grid gap-3">
      <ul className="grid" aria-label="Recent activity">
        {list.map((item) => (
          <li
            key={`${item.extractor}|${item.videoId}`}
            className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0"
          >
            <div className="grid min-w-0 flex-1">
              <ItemTitle item={item} />
              <p className="truncate text-xs text-muted-foreground">
                {[item.reason, `seen ${relativeTime(item.seenAt)}`].filter(Boolean).join(" · ")}
              </p>
            </div>
            <ItemOutcomeBadge outcome={item.outcome} />
          </li>
        ))}
      </ul>
      {items.hasNextPage ? (
        <Button
          variant="quiet"
          className="justify-self-center"
          disabled={items.isFetchingNextPage}
          onClick={() => void items.fetchNextPage()}
        >
          Show more
        </Button>
      ) : null}
    </div>
  );
}
