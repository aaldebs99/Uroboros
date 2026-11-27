import type { ClipRange, LibraryItem } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { LibraryBig, ListPlus, Scissors, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { useRemoveEntry } from "@/api/library";
import { addToLibrary } from "@/api/sharing";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { notify } from "@/components/ui/sonner";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDuration } from "@/downloads/format";

import { ShareButton } from "../sharing/ShareDialog";
import { AddToPlaylist } from "./AddToPlaylist";
import { EditDetailsDialog } from "./EditDetailsDialog";
import { ItemMenu } from "./ItemMenu";
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

/** One of the watch page's actions: an icon button named by its tooltip and its label. */
function IconAction({
  label,
  icon: Icon,
  variant = "icon",
  disabled = false,
  pressed,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  variant?: "icon" | "destructive";
  disabled?: boolean;
  /** A toggle's state (aria-pressed), in the accent while on. */
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <Button
        variant={variant}
        size="icon"
        aria-label={label}
        aria-pressed={pressed}
        className={pressed === true ? "bg-accent text-primary" : undefined}
        disabled={disabled}
        onClick={onClick}
      >
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

interface ActionsProps {
  item: LibraryItem;
  /** Mark as unwatched (the ⋮ menu): the page's player goes back to the start, paused. */
  onStartOver?: (() => void) | undefined;
  /** The clip picked in the player (docs/sharing.md#clips): Save and Share offer just it. */
  clip?: ClipRange | null;
  /** The Clip button's press, picking a clip or dropping it; no button without it (clips off). */
  onClip?: (() => void) | undefined;
  /** Whether a clip can be picked yet (the video's length is known). */
  canClip?: boolean;
}

/**
 * The watch page's icon buttons, 0.5rem apart: six of them (Clip with the rest) nearly fill a 375
 * pixel phone's row, so the row wraps rather than widen the page.
 */
const actionRow = "flex flex-wrap items-center gap-2";

/** Clip (docs/sharing.md#clips): picks a range on the timeline, or drops the one picked. */
function ClipAction({ clip = null, onClip, canClip = false }: ActionsProps) {
  if (onClip === undefined) return null;
  return (
    <IconAction
      label="Clip"
      icon={Scissors}
      pressed={clip !== null}
      disabled={!canClip}
      onClick={onClip}
    />
  );
}

/**
 * The person's own actions on their entry, icon buttons each named in its tooltip: Clip, Save, Save
 * to playlist, Share, Remove, and the ⋮ menu (`ItemMenu`), which holds Edit details: for everyone on
 * their upload (docs/uploads.md), for them alone on any other video (docs/library.md#your-own-details).
 */
function OwnActions(props: ActionsProps) {
  const { item, onStartOver, clip = null } = props;
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const edit =
    item.editable || item.personalEditable
      ? () => {
          setEditing(true);
        }
      : undefined;
  return (
    <>
      <div className={actionRow}>
        <ClipAction {...props} />
        <SaveFile item={item} clip={clip} />
        <IconAction
          label="Save to playlist"
          icon={ListPlus}
          onClick={() => {
            setSaving(true);
          }}
        />
        <ShareButton kind="entry" id={item.id} title={item.title} clip={clip} iconOnly />
        <RemoveButton item={item} />
        <ItemMenu item={item} onStartOver={onStartOver} onEdit={edit} />
      </div>
      {saving ? (
        <AddToPlaylist entryId={item.id} title={item.title} open onOpenChange={setSaving} />
      ) : null}
      {editing ? <EditDetailsDialog item={item} open onOpenChange={setEditing} /> : null}
    </>
  );
}

/**
 * The row under a watch page's title: the channel and the actions, the ⋮ menu last. On the
 * person's own entry those are theirs (docs/library.md); on one shared with them (docs/sharing.md),
 * who shared it, Save and Add to my library.
 */
export function ItemActions(props: ActionsProps) {
  const { item, onStartOver, clip = null } = props;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <ChannelLine item={item} />
      {item.sharedBy === null ? (
        <OwnActions {...props} />
      ) : (
        <>
          <span className="text-sm text-muted-foreground">Shared by {item.sharedBy}</span>
          <div className={actionRow}>
            <ClipAction {...props} />
            <SaveFile item={item} clip={clip} />
            <AddToMine item={item} />
            <ItemMenu item={item} onStartOver={onStartOver} />
          </div>
        </>
      )}
    </div>
  );
}
