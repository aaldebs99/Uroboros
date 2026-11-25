import {
  DownloadRequest,
  McpDeleted,
  McpDownloadLinkInput,
  McpNoInput,
  McpSubscriptionInput,
  McpSubscriptionItemsInput,
  McpSubscriptions,
  McpUpdateSubscriptionInput,
  NewSubscriptionBody,
  Subscription,
  SubscriptionItemsPage,
} from "@uroboros/contract";
import { createRequest } from "../../downloads/requests.ts";
import { need } from "../../downloads/routes.ts";
import { listItems } from "../../subscriptions/items.ts";
import {
  checkSubscriptionNow,
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  updateSubscription,
} from "../../subscriptions/subscriptions.ts";
import { defineTool, type Tool } from "../tool.ts";

export const subscriptionTools: Tool[] = [
  defineTool({
    name: "list_subscriptions",
    title: "List subscriptions",
    description:
      "The channels and playlists the person follows: what each downloads, its schedule, its filters, when it was last checked and whether it is paused (enabled false).",
    input: McpNoInput,
    output: McpSubscriptions,
    run: async (_args, { downloads, caller }) => ({
      subscriptions: await listSubscriptions(need(downloads).db, caller.userId),
    }),
  }),
  defineTool({
    name: "list_subscription_items",
    title: "List a subscription's activity",
    description:
      "A subscription's recent videos, newest first: downloaded, waiting, or skipped and why. Page with cursor.",
    input: McpSubscriptionItemsInput,
    output: SubscriptionItemsPage,
    run: ({ subscriptionId, cursor }, { downloads, caller }) =>
      listItems(need(downloads).db, caller.userId, subscriptionId, cursor),
  }),
  defineTool({
    name: "preview_subscription",
    title: "Preview a subscription",
    description:
      "The first step of subscribing: reads a channel or playlist link. When get_download_request shows it in state choosing, its groups are the feeds (a channel's tabs) create_subscription can follow; a single video fails as not_a_feed.",
    input: McpDownloadLinkInput,
    output: DownloadRequest,
    write: true,
    openWorld: true,
    run: (args, { downloads, caller }) =>
      createRequest(need(downloads), caller.userId, { ...args, intent: "subscribe" }),
  }),
  defineTool({
    name: "create_subscription",
    title: "Subscribe",
    description:
      "Follows a channel or playlist from a preview in state choosing: feeds names its groups to follow, profileId the format (list_profiles), schedule how often to check (an interval in minutes, a cron in a timezone, or manual: only when check_subscription asks). New videos download as they appear unless autoDownload is false, which leaves them new in the activity for the person to pick; a scheduled subscription's first check runs at once.",
    input: NewSubscriptionBody,
    output: Subscription,
    write: true,
    openWorld: true,
    run: (body, { downloads, caller }) => createSubscription(need(downloads), caller.userId, body),
  }),
  defineTool({
    name: "update_subscription",
    title: "Change a subscription",
    description:
      "Changes a subscription: its feeds, format, schedule (manual stops scheduled checks), filters, delay, retention, notifications or autoDownload; enabled false pauses it and true resumes it. A tighter retention deletes the videos it no longer keeps.",
    input: McpUpdateSubscriptionInput,
    output: Subscription,
    write: true,
    // A tighter retention (keepLast, deleteWatchedAfterDays) has the reaper remove entries.
    destructive: true,
    idempotent: true,
    run: ({ subscriptionId, changes }, { downloads, caller }) =>
      updateSubscription(need(downloads), caller.userId, subscriptionId, changes),
  }),
  defineTool({
    name: "delete_subscription",
    title: "Unsubscribe",
    description:
      "Stops following a channel or playlist. Its downloads not started yet are cancelled; videos already in the library stay.",
    input: McpSubscriptionInput,
    output: McpDeleted,
    write: true,
    destructive: true,
    run: async ({ subscriptionId }, { downloads, caller }) => {
      await deleteSubscription(need(downloads), caller.userId, subscriptionId);
      return { deleted: subscriptionId };
    },
  }),
  defineTool({
    name: "check_subscription_now",
    title: "Check a subscription now",
    description:
      "Looks for new videos now instead of waiting for the schedule; a paused subscription is refused.",
    input: McpSubscriptionInput,
    output: Subscription,
    write: true,
    openWorld: true,
    idempotent: true,
    run: ({ subscriptionId }, { downloads, caller }) =>
      checkSubscriptionNow(need(downloads), caller.userId, subscriptionId),
  }),
];
