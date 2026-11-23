import {
  Subscription,
  SubscriptionItemsPage,
  type NewSubscriptionBody,
  type SubscriptionPatch,
} from "@uroboros/contract";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { deleteJson, getJson, patchJson, postJson } from "./client";

export const subscriptionKeys = {
  all: ["api", "subscriptions"] as const,
  one: (id: string) => ["api", "subscriptions", id] as const,
  items: (id: string) => ["api", "subscriptions", id, "items"] as const,
};

const path = (id: string) => `/api/subscriptions/${encodeURIComponent(id)}`;
/** While a check runs the lists refetch this often, so its outcome shows up by itself. */
const CHECKING_POLL_MS = 3000;

/** The caller's subscriptions; polled while any check runs. */
export function useSubscriptions() {
  return useQuery({
    queryKey: subscriptionKeys.all,
    queryFn: ({ signal }) => getJson("/api/subscriptions", z.array(Subscription), { signal }),
    refetchInterval: (query) =>
      query.state.data?.some((s) => s.checking) === true ? CHECKING_POLL_MS : false,
  });
}

export function useSubscription(id: string) {
  return useQuery({
    queryKey: subscriptionKeys.one(id),
    queryFn: ({ signal }) => getJson(path(id), Subscription, { signal }),
    refetchInterval: (query) => (query.state.data?.checking === true ? CHECKING_POLL_MS : false),
  });
}

/** What a subscription has seen, newest first, a page at a time. */
export function useSubscriptionItems(id: string) {
  return useInfiniteQuery({
    queryKey: subscriptionKeys.items(id),
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
