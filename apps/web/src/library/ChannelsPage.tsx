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
    <section className="grid w-full gap-6">
      <PageHeader title="Channels" />
      <ViewTabs />
      {channels.isError ? <p className="text-destructive">{errorText(channels.error)}</p> : null}
      {channels.isSuccess && list.length === 0 ? (
        <EmptyState icon={Tv} title="No channels yet.">
          Channels of the videos you download show up here.
        </EmptyState>
      ) : (
        <ul className="grid gap-1 sm:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]">
          {list.map((c) => (
            <li key={c.key}>
              <Link
                to="/library/channels/$channelKey"
                params={{ channelKey: c.key }}
                className="flex items-center gap-4 rounded-[0.75rem] p-3 hover:bg-raised focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none"
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
