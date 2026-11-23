import type { Subscription } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Rss } from "lucide-react";
import { useState, type ReactNode } from "react";

import { errorText } from "@/api/client";
import {
  checkSubscription,
  deleteSubscription,
  subscriptionKeys,
  updateSubscription,
  useSubscriptions,
} from "@/api/subscriptions";
import { DownloadDialog } from "@/components/DownloadDialog";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/components/ui/sonner";

import { SubscriptionRow, type RowActions } from "./SubscriptionRow";

/** The row actions, each refreshing the subscriptions and toasting a failure. */
export function useSubscriptionActions(): RowActions & { dialog: ReactNode } {
  const client = useQueryClient();
  const confirm = useConfirm();
  const run = (work: Promise<unknown>, done?: string) => {
    work
      .then(() => client.invalidateQueries({ queryKey: subscriptionKeys.all }))
      .then(() => {
        if (done !== undefined) notify.success(done);
      })
      .catch((err: unknown) => {
        notify.error(errorText(err));
      });
  };
  return {
    check: (sub) => {
      run(checkSubscription(sub.id), `Checking ${sub.title ?? "the subscription"}.`);
    },
    setEnabled: (sub, enabled) => {
      run(updateSubscription(sub.id, { enabled }), enabled ? "Resumed." : "Paused.");
    },
    unsubscribe: (sub: Subscription) => {
      const title = sub.title ?? sub.url;
      confirm.ask({
        title: `Unsubscribe from ${title}?`,
        description:
          "Downloads it queued that have not started are cancelled. Videos already in your library stay.",
        confirmLabel: "Unsubscribe",
        destructive: true,
        onConfirm: () => {
          run(deleteSubscription(sub.id), `Unsubscribed from ${title}.`);
        },
      });
    },
    dialog: confirm.dialog,
  };
}

/** Subscriptions: the channels and playlists the person follows, and how each is doing. */
export function SubscriptionsPage() {
  const subs = useSubscriptions();
  const actions = useSubscriptionActions();
  const [adding, setAdding] = useState(false);
  const list = subs.data ?? [];
  const add = (
    <Button
      onClick={() => {
        setAdding(true);
      }}
    >
      <Plus aria-hidden /> Add subscription
    </Button>
  );
  return (
    <section className="grid w-full gap-6">
      <PageHeader
        title="Subscriptions"
        description="Channels and playlists, kept up to date."
        action={list.length > 0 ? add : undefined}
      />
      {subs.isError ? <p className="text-destructive">{errorText(subs.error)}</p> : null}
      {subs.isSuccess && list.length === 0 ? (
        <EmptyState icon={Rss} title="No subscriptions yet" action={add}>
          Follow a channel or playlist and its new videos download by themselves.
        </EmptyState>
      ) : (
        <ul className="grid gap-1" aria-label="Subscriptions">
          {list.map((sub) => (
            <SubscriptionRow key={sub.id} sub={sub} actions={actions} />
          ))}
        </ul>
      )}
      {actions.dialog}
      <DownloadDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add a subscription"
        hint="Paste a channel or playlist link. Its preview offers Subscribe."
      />
    </section>
  );
}
