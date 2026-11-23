import { SearchX } from "lucide-react";

import { useChannels } from "@/api/library";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/ui/empty-state";

import { LibraryGrid } from "./LibraryGrid";

/** One channel: its header, then the person's videos from it. */
export function ChannelPage({ channelKey }: { channelKey: string }) {
  const channel = useChannels().data?.find((c) => c.key === channelKey);
  return (
    <section className="grid w-full gap-6">
      <header className="flex items-center gap-4 border-b border-border pb-4">
        <Avatar name={channel?.name ?? null} className="size-20 text-2xl" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{channel?.name ?? "Channel"}</h1>
          {channel === undefined ? null : (
            <p className="text-sm text-muted-foreground">{channel.count} downloaded</p>
          )}
        </div>
      </header>
      <LibraryGrid
        filters={{ channel: channelKey }}
        empty={
          <EmptyState icon={SearchX} title="Nothing from this channel.">
            Its videos may have left your library.
          </EmptyState>
        }
      />
    </section>
  );
}
