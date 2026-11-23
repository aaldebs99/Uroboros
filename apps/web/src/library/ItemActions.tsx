import type { LibraryItem } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Download, ExternalLink, ListPlus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { errorText } from "@/api/client";
import { itemKey, setKept, setWatched, useRemoveEntry } from "@/api/library";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { notify } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { formatDuration } from "@/downloads/format";

import { AddToPlaylist } from "./AddToPlaylist";

function ChannelLine({ item }: { item: LibraryItem }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Avatar name={item.channel} />
      <div className="min-w-0">
        {item.channelKey === null ? (
          <p className="truncate font-medium">{item.channel ?? "Unknown channel"}</p>
        ) : (
          <Link
            to="/library/channels/$channelKey"
            params={{ channelKey: item.channelKey }}
            className="truncate font-medium hover:underline"
          >
            {item.channel}
          </Link>
        )}
        <p className="text-xs text-muted-foreground">
          {[
            item.uploadDate,
            item.duration === null ? null : formatDuration(item.duration),
            item.profileName,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </div>
  );
}

/** Keep, for an entry a subscription brought: retention never removes it. */
function KeepSwitch({ item }: { item: LibraryItem }) {
  const client = useQueryClient();
  if (item.subscription === null) return null;
  return (
    <label className="flex items-center gap-2 text-sm" title="Retention never removes this video">
      <Switch
        aria-label="Keep"
        aria-describedby="keep-help"
        checked={item.kept}
        onCheckedChange={(kept) => {
          setKept(item.id, kept)
            .then(() => client.invalidateQueries({ queryKey: itemKey(item.id) }))
            .catch((err: unknown) => {
              notify.error(errorText(err));
            });
        }}
      />
      Keep
      <span id="keep-help" className="sr-only">
        Retention never removes this video
      </span>
    </label>
  );
}

function RemoveButton({ item }: { item: LibraryItem }) {
  const confirm = useConfirm();
  const remove = useRemoveEntry();
  const navigate = useNavigate();
  return (
    <>
      <Button
        variant="destructive"
        onClick={() => {
          confirm.ask({
            title: `Remove "${item.title}"?`,
            description: "It leaves your library. Others who downloaded it keep their copy.",
            confirmLabel: "Remove",
            destructive: true,
            onConfirm: () => {
              remove.mutate(item.id, {
                onSuccess: () => void navigate({ to: "/" }),
                onError: (err) => {
                  notify.error(errorText(err));
                },
              });
            },
          });
        }}
      >
        <Trash2 aria-hidden /> Remove
      </Button>
      {confirm.dialog}
    </>
  );
}

/**
 * The row under a watch page's title: the channel, Watched, and the person's actions on their own
 * entry (Keep, Save, Save to playlist, Remove); `extra` adds more (Share).
 */
export function ItemActions({ item, extra }: { item: LibraryItem; extra?: ReactNode }) {
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <ChannelLine item={item} />
      <label className="flex items-center gap-2 text-sm">
        <Switch
          aria-label="Watched"
          checked={item.progress?.watched ?? false}
          onCheckedChange={(watched) => {
            setWatched(item.id, watched)
              .then(() => client.invalidateQueries({ queryKey: ["api", "library"] }))
              .catch((err: unknown) => {
                notify.error(errorText(err));
              });
          }}
        />
        Watched
      </label>
      <KeepSwitch item={item} />
      <Button variant="secondary" asChild>
        <a href={`/api/library/${item.id}/file`} download>
          <Download aria-hidden /> Save
        </a>
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          setSaving(true);
        }}
      >
        <ListPlus aria-hidden /> Save to playlist
      </Button>
      {extra}
      <RemoveButton item={item} />
      {item.webpageUrl === null ? null : (
        <Button variant="ghost" asChild>
          <a href={item.webpageUrl} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden /> Open on the site
          </a>
        </Button>
      )}
      {saving ? (
        <AddToPlaylist entryId={item.id} title={item.title} open onOpenChange={setSaving} />
      ) : null}
    </div>
  );
}
