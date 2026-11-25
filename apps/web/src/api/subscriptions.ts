import {
  QueueSelectionResult,
  Subscription,
  SubscriptionItemsPage,
  type ItemDownloadBody,
  type NewSubscriptionBody,
  type SubscriptionPatch,
} from "@uroboros/contract";
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { z } from "zod";

import { deleteJson, getJson, patchJson, postJson, postNoContent } from "./client";

export const subscriptionKeys = {
  all: ["api", "subscriptions"] as const,
  one: (id: string) => ["api", "subscriptions", id] as const,
  /** Keyed by the last check too, so a finished check loads its activity afresh. */
  items: (id: string, lastCheckedAt: string | null = null) =>
    ["api", "subscriptions", id, "items", lastCheckedAt] as const,
};

/**
 * Fetches again every loaded activity list holding this download, so its row follows the download
 * (Queued, Downloading, Downloaded) without waiting for the next check.
 */
export function refreshActivityHolding(client: QueryClient, downloadId: string): void {
  void client.invalidateQueries({
    queryKey: subscriptionKeys.all,
    predicate: (query) =>
      query.queryKey[3] === "items" &&
      ((query.state.data as InfiniteData<SubscriptionItemsPage> | undefined)?.pages ?? []).some(
        (page) => page.items.some((item) => item.downloadId === downloadId),
      ),
  });
}

const path = (id: string) => `/api/subscriptions/${encodeURIComponent(id)}`;
/** While a check runs (or a new one has yet to) the lists refetch this often. */
const CHECKING_POLL_MS = 3000;

/** A check is running, or an enabled subscription has never been checked: its first is coming. */
const pending = (s: Subscription) => s.checking || (s.enabled && s.lastCheckedAt === null);

/** The caller's subscriptions; polled while any check runs. */
export function useSubscriptions() {
  return useQuery({
    queryKey: subscriptionKeys.all,
    queryFn: ({ signal }) => getJson("/api/subscriptions", z.array(Subscription), { signal }),
    refetchInterval: (query) =>
      query.state.data?.some(pending) === true ? CHECKING_POLL_MS : false,
  });
}

export function useSubscription(id: string) {
  return useQuery({
    queryKey: subscriptionKeys.one(id),
    queryFn: ({ signal }) => getJson(path(id), Subscription, { signal }),
    refetchInterval: (query) => {
      const s = query.state.data;
      return s !== undefined && pending(s) ? CHECKING_POLL_MS : false;
    },
  });
}

/** What a subscription has seen, newest first, a page at a time, as of its last check. */
export function useSubscriptionItems(id: string, lastCheckedAt: string | null) {
  return useInfiniteQuery({
    queryKey: subscriptionKeys.items(id, lastCheckedAt),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getJson(
        `${path(id)}/items${pageParam === null ? "" : `?cursor=${encodeURIComponent(pageParam)}`}`,
        SubscriptionItemsPage,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export const createSubscription = (body: NewSubscriptionBody) =>
  postJson("/api/subscriptions", Subscription, body);

export const updateSubscription = (id: string, patch: SubscriptionPatch) =>
  patchJson(path(id), Subscription, patch);

export const deleteSubscription = (id: string) => deleteJson(path(id));

export const checkSubscription = (id: string) => postJson(`${path(id)}/check`, Subscription);
/** Downloads one video from the subscription's activity that it skipped, filtered or holds. */
export const downloadSubscriptionItem = (id: string, item: ItemDownloadBody) =>
  postJson(`${path(id)}/items/download`, QueueSelectionResult, item);
/** Downloads the subscription's latest `count` videos (a job lists them; 202). */
export const downloadLatest = (id: string, count: number) =>
  postNoContent(`${path(id)}/latest`, { count });
