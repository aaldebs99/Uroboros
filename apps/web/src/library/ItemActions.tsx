import type { LibraryItem } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Download, ExternalLink, LibraryBig, ListPlus, Trash2 } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { itemKey, setKept, setWatched, useRemoveEntry } from "@/api/library";
import { addToLibrary } from "@/api/sharing";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { notify } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { formatDuration } from "@/downloads/format";

import { ShareButton } from "../sharing/ShareDialog";
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

/** Add to my library, for a video someone shared: the person's own entry on the same file. */
function AddToMine({ item }: { item: LibraryItem }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={() => {
        setBusy(true);
        addToLibrary(item.id)
          .then(async (mine) => {
            notify.success("Added to your library.");
            await client.invalidateQueries({ queryKey: ["api", "library"] });
            await navigate({ to: "/library/$entryId", params: { entryId: mine.id } });
          })
          .catch((err: unknown) => {
            notify.error(errorText(err));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <LibraryBig aria-hidden /> Add to my library
    </Button>
  );
}

function SaveFile({ item }: { item: LibraryItem }) {
  return (
    <Button variant="secondary" asChild>
      <a href={`/api/library/${item.id}/file`} download>
        <Download aria-hidden /> Save
      </a>
    </Button>
  );
}

/** The person's own actions on their entry: Keep, Save, Save to playlist, Share, Remove. */
function OwnActions({ item }: { item: LibraryItem }) {
  const [saving, setSaving] = useState(false);
  return (
    <>
      <KeepSwitch item={item} />
      <SaveFile item={item} />
      <Button
        variant="secondary"
        onClick={() => {
          setSaving(true);
        }}
      >
        <ListPlus aria-hidden /> Save to playlist
      </Button>
      <ShareButton kind="entry" id={item.id} title={item.title} />
      <RemoveButton item={item} />
      {saving ? (
        <AddToPlaylist entryId={item.id} title={item.title} open onOpenChange={setSaving} />
      ) : null}
    </>
  );
}

/**
 * The row under a watch page's title: the channel, Watched, and the actions. On the person's own
 * entry those are theirs (docs/library.md); on one shared with them (docs/sharing.md), who shared
 * it, Save and Add to my library.
 */
export function ItemActions({ item }: { item: LibraryItem }) {
  const client = useQueryClient();
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
      {item.sharedBy === null ? (
        <OwnActions item={item} />
      ) : (
        <>
          <span className="text-sm text-muted-foreground">Shared by {item.sharedBy}</span>
          <SaveFile item={item} />
          <AddToMine item={item} />
        </>
      )}
      {item.webpageUrl === null ? null : (
        <Button variant="ghost" asChild>
          <a href={item.webpageUrl} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden /> Open on the site
          </a>
        </Button>
      )}
    </div>
  );
}
