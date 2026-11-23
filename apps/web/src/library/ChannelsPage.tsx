import { Link } from "@tanstack/react-router";
import { Tv } from "lucide-react";

import { errorText } from "@/api/client";
import { useChannels } from "@/api/library";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { ViewTabs } from "./ViewTabs";

/** The channels in the person's library, most downloaded first. */
export function ChannelsPage() {
  const channels = useChannels();
  const list = channels.data ?? [];
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-6">
      <PageHeader title="Library" description="Everything you have downloaded, in one place." />
      <ViewTabs />
      {channels.isError ? <p className="text-destructive">{errorText(channels.error)}</p> : null}
      {channels.isSuccess && list.length === 0 ? (
        <EmptyState icon={Tv} title="No channels yet.">
          Channels of the videos you download show up here.
        </EmptyState>
      ) : (
        <ul className="grid gap-1 md:grid-cols-2">
          {list.map((c) => (
            <li key={c.key}>
              <Link
                to="/library/channels/$channelKey"
                params={{ channelKey: c.key }}
                className="flex items-center gap-4 rounded-[12px] p-3 hover:bg-raised focus-visible:ring-[3px] focus-visible:ring-ring/45 focus-visible:outline-none"
              >
                <Avatar name={c.name} className="size-14 text-lg" />
                <span className="min-w-0">
                  <span className="block truncate text-base font-medium">{c.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.count} downloaded
                    {c.latestUpload === null ? "" : ` · latest ${c.latestUpload}`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
