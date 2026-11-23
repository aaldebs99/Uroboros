import type { Subscription } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";
import { Pause, Play, RefreshCw } from "lucide-react";

import { errorText } from "@/api/client";
import { useSubscription } from "@/api/subscriptions";
import { SubscriptionBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsGroup, SettingsRow } from "@/components/ui/settings-row";

import { ActivityList } from "./ActivityList";
import { intervalLabel, scheduleLabel, sourceLabel } from "./format";
import { useSubscriptionActions } from "./SubscriptionsPage";

function filtersSummary(f: Subscription["filters"]): string {
  const parts = [
    f.titleInclude === null ? null : `title matches ${f.titleInclude}`,
    f.titleExclude === null ? null : `title does not match ${f.titleExclude}`,
    f.minDuration === null ? null : `at least ${String(f.minDuration)} s`,
    f.maxDuration === null ? null : `at most ${String(f.maxDuration)} s`,
    f.uploadedAfter === null ? null : `uploaded on or after ${f.uploadedAfter}`,
    f.excludeShorts ? "no Shorts" : null,
    f.excludeLive ? "no live streams" : null,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? "Everything new" : parts.join("; ");
}

function retentionSummary(r: Subscription["retention"]): string {
  const parts = [
    r.keepLast === null ? null : `keep the newest ${String(r.keepLast)}`,
    r.deleteWatchedAfterDays === null
      ? null
      : `remove ${String(r.deleteWatchedAfterDays)} days after watching`,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? "Keep everything" : parts.join("; ");
}

function Header({ sub }: { sub: Subscription }) {
  const actions = useSubscriptionActions();
  return (
    <>
      <PageHeader
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

/** Read-only settings; the edit form replaces this in the next step. */
function Settings({ sub }: { sub: Subscription }) {
  return (
    <SettingsGroup title="Settings">
      <SettingsRow label="What" description={sourceLabel(sub)} />
      <SettingsRow label="Format" description={sub.profileName} />
      <SettingsRow label="Checks" description={intervalLabel(sub.intervalMinutes)} />
      <SettingsRow label="Filters" description={filtersSummary(sub.filters)} />
      <SettingsRow label="Retention" description={retentionSummary(sub.retention)} />
    </SettingsGroup>
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
        <ActivityList subscriptionId={sub.id} />
      </div>
    </section>
  );
}
