import type { SubscriptionItem } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, ExternalLink, LoaderCircle, Play } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import {
  downloadSubscriptionItem,
  subscriptionKeys,
  useSubscriptionItems,
} from "@/api/subscriptions";
import { ItemOutcomeBadge } from "@/components/StatusBadge";
import { Button, buttonVariants } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

import { relativeTime } from "./format";

const titleOf = (item: SubscriptionItem) => item.title ?? item.videoId;

/** The video's own page on its site, in a new tab. */
function ItemTitle({ item }: { item: SubscriptionItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="flex min-w-0 items-center gap-1.5 font-medium hover:underline focus-visible:rounded-[0.25rem] focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none"
    >
      <span className="truncate">{titleOf(item)}</span>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">(opens the site)</span>
    </a>
  );
}

/** What a subscription didn't download by itself: skipped, filtered, new or still waiting. */
const downloadable = (item: SubscriptionItem) => item.entryId === null && item.outcome !== "queued";

/** Watch it in the library once it's there, or download one the subscription passed over. */
function ItemAction({ subscriptionId, item }: { subscriptionId: string; item: SubscriptionItem }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (item.entryId !== null) {
    return (
      <Link
        to="/library/$entryId"
        params={{ entryId: item.entryId }}
        aria-label={`Watch ${titleOf(item)}`}
        className={cn(buttonVariants({ variant: "quiet", size: "compact" }), "max-md:px-2.5")}
      >
        <Play aria-hidden /> <span className="max-md:sr-only">Watch</span>
      </Link>
    );
  }
  if (!downloadable(item)) return null;
  const download = () => {
    setBusy(true);
    downloadSubscriptionItem(subscriptionId, { extractor: item.extractor, videoId: item.videoId })
      .then(async (result) => {
        notify.success(result.queued > 0 ? "Queued" : "Already in your library or on its way", {
          detail: titleOf(item),
        });
        await client.invalidateQueries({
          queryKey: [...subscriptionKeys.one(subscriptionId), "items"],
        });
      })
      .catch((err: unknown) => {
        notify.error(errorText(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <Button
      variant="secondary"
      size="compact"
      // On a phone, only the icon: the title keeps the row's room (the label names the video).
      className="max-md:px-2.5"
      aria-label={`Download ${titleOf(item)}`}
      disabled={busy}
      onClick={download}
    >
      {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Download aria-hidden />}
      <span className="max-md:sr-only">Download</span>
    </Button>
  );
}

/**
 * What the subscription saw, newest first: each video (its title opens it on its site), its outcome
 * and why, and a way to watch it or, when the subscription passed it over, download it now.
 */
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
            <div className="flex shrink-0 items-center gap-2">
              <ItemOutcomeBadge item={item} />
              <ItemAction subscriptionId={subscriptionId} item={item} />
            </div>
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
