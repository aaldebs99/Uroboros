import type { Subscription } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pause, Play, RefreshCw } from "lucide-react";

import { errorText } from "@/api/client";
import { subscriptionKeys, updateSubscription, useSubscription } from "@/api/subscriptions";
import { SubscriptionBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/components/ui/sonner";

import { ActivityList } from "./ActivityList";
import { scheduleLabel, sourceLabel } from "./format";
import { fromSubscription, toPatch } from "./formValues";
import { SubscriptionForm } from "./SubscriptionForm";
import { useSubscriptionActions } from "./SubscriptionsPage";

function Header({ sub }: { sub: Subscription }) {
  const actions = useSubscriptionActions();
  return (
    <>
      <PageHeader
        showTitle
        title={sub.title ?? sub.url}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {sourceLabel(sub)} · {scheduleLabel(sub)}
            <SubscriptionBadge sub={sub} />
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            {sub.enabled ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    actions.check(sub);
                  }}
                >
                  <RefreshCw aria-hidden /> Check now
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => {
                    actions.setEnabled(sub, false);
                  }}
                >
                  <Pause aria-hidden /> Pause
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  actions.setEnabled(sub, true);
                }}
              >
                <Play aria-hidden /> Resume
              </Button>
            )}
          </div>
        }
      />
      {actions.dialog}
    </>
  );
}

/** The settings form; saving sends only what changed. */
function Settings({ sub }: { sub: Subscription }) {
  const client = useQueryClient();
  const initial = fromSubscription(sub);
  return (
    <SubscriptionForm
      key={sub.id}
      initial={initial}
      kind={sub.kind}
      tabs={sub.tabs.map((t) => t.name)}
      isNew={false}
      submitLabel="Save changes"
      onSubmit={async (values) => {
        const patch = toPatch(values, initial);
        if (Object.keys(patch).length === 0) {
          notify.success("Nothing to change.");
          return;
        }
        try {
          await updateSubscription(sub.id, patch);
          await client.invalidateQueries({ queryKey: subscriptionKeys.all });
          notify.success("Saved.");
        } catch (err) {
          notify.error(errorText(err));
        }
      }}
    />
  );
}

/** One subscription: its state, settings and what its checks found. */
export function SubscriptionPage({ subscriptionId }: { subscriptionId: string }) {
  const query = useSubscription(subscriptionId);
  const sub = query.data;
  if (query.isError) return <p className="text-destructive">{errorText(query.error)}</p>;
  if (sub === undefined) return null;
  return (
    <section className="grid w-full gap-6">
      <Header sub={sub} />
      {sub.error === null ? null : (
        <Notice tone="destructive" title="The last check failed">
          {sub.error.message}
        </Notice>
      )}
      {sub.warning === null ? null : <Notice tone="warning" title={sub.warning} />}
      {sub.channelKey === null ? null : (
        <Link
          to="/library/channels/$channelKey"
          params={{ channelKey: sub.channelKey }}
          className="text-sm text-primary hover:underline"
        >
          Open the channel in your library
        </Link>
      )}
      <Settings sub={sub} />
      <div className="grid gap-2">
        <h2 className="text-base font-bold">Recent activity</h2>
        <ActivityList subscriptionId={sub.id} lastCheckedAt={sub.lastCheckedAt} />
      </div>
    </section>
  );
}
