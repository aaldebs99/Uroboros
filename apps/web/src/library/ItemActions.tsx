import type { LibraryItem } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ExternalLink, LibraryBig, ListPlus, Pencil, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { itemKey, setKept, setWatched, useRemoveEntry } from "@/api/library";
import { addToLibrary } from "@/api/sharing";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { notify } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDuration } from "@/downloads/format";

import { ShareButton } from "../sharing/ShareDialog";
import { AddToPlaylist } from "./AddToPlaylist";
import { EditDetailsDialog } from "./EditDetailsDialog";
import { removeDescription } from "./removeText";
import { SaveFile } from "./SaveFile";

function ChannelLine({ item }: { item: LibraryItem }) {
  // A real basis (not flex-1's zero): when the row is short the actions wrap below, rather than
  // squeezing the name to nothing.
  return (
    <div className="flex min-w-0 grow basis-56 items-center gap-3">
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

/** One of the watch page's actions: an icon button named by its tooltip and its label. */
function IconAction({
  label,
  icon: Icon,
  variant = "icon",
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  variant?: "icon" | "destructive";
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <Button variant={variant} size="icon" aria-label={label} onClick={onClick}>
        <Icon aria-hidden />
      </Button>
    </Tooltip>
  );
}

function RemoveButton({ item }: { item: LibraryItem }) {
  const confirm = useConfirm();
  const remove = useRemoveEntry();
  const navigate = useNavigate();
  return (
    <>
      <IconAction
        label="Remove"
        icon={Trash2}
        variant="destructive"
        onClick={() => {
          confirm.ask({
            title: `Remove "${item.title}"?`,
            description: removeDescription(item.origin),
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
      />
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

/** Edit details, on a video the person uploaded (docs/uploads.md). */
function EditButton({ item }: { item: LibraryItem }) {
  const [editing, setEditing] = useState(false);
  if (!item.editable) return null;
  return (
    <>
      <IconAction
        label="Edit details"
        icon={Pencil}
        onClick={() => {
          setEditing(true);
        }}
      />
      {editing ? <EditDetailsDialog item={item} open onOpenChange={setEditing} /> : null}
    </>
  );
}

/** The watch page's icon buttons sit closer from `md` up, where a pointer can't miss. */
const actionRow = "flex items-center gap-4 md:gap-2";

/**
 * The person's own actions on their entry: Keep, then the icon buttons, each named in its
 * tooltip: Edit details (an upload), Save, Save to playlist, Share, Remove.
 */
function OwnActions({ item }: { item: LibraryItem }) {
  const [saving, setSaving] = useState(false);
  return (
    <>
      <KeepSwitch item={item} />
      <div className={actionRow}>
        <EditButton item={item} />
        <SaveFile item={item} />
        <IconAction
          label="Save to playlist"
          icon={ListPlus}
          onClick={() => {
            setSaving(true);
          }}
        />
        <ShareButton kind="entry" id={item.id} title={item.title} iconOnly />
        <RemoveButton item={item} />
      </div>
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
          <div className={actionRow}>
            <SaveFile item={item} />
            <AddToMine item={item} />
          </div>
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
