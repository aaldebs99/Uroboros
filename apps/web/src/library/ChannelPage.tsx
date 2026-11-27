import { SearchX } from "lucide-react";

import { useChannels, useSetChannelHidden } from "@/api/library";
import { Avatar } from "@/components/Avatar";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState } from "@/components/ui/empty-state";

import { HideFromLibraryButton } from "./HideFromLibraryButton";
import { LibraryGrid } from "./LibraryGrid";

/**
 * One channel: its header, with Hide from library (docs/library.md "Hiding from the library"), then
 * the person's videos from it, hidden or not.
 */
export function ChannelPage({ channelKey }: { channelKey: string }) {
  const channel = useChannels().data?.find((c) => c.key === channelKey);
  const hide = useSetChannelHidden();
  return (
    <section className="grid w-full gap-6">
      <BackLink to="/library/channels">Channels</BackLink>
      <header className="flex flex-wrap items-center gap-4 border-b border-border pb-4">
        <Avatar name={channel?.name ?? null} className="size-20 text-2xl" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{channel?.name ?? "Channel"}</h1>
          {channel === undefined ? null : (
            <p className="text-sm text-muted-foreground">
              {channel.count} downloaded{channel.hideFromLibrary ? " · Hidden from library" : ""}
            </p>
          )}
        </div>
        {channel === undefined ? null : (
          <HideFromLibraryButton
            hidden={channel.hideFromLibrary}
            pending={hide.isPending}
            toggle={(hidden) => hide.mutateAsync({ key: channel.key, hidden })}
          />
        )}
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
