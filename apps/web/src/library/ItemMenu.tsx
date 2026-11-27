import type { LibraryItem } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  EyeOff,
  ExternalLink,
  MoreVertical,
  Pencil,
  Pin,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { errorText } from "@/api/client";
import { itemKey, refetchSkipSegments, setKept, setWatched } from "@/api/library";
import { Button } from "@/components/ui/button";
import { type MenuAction, ResponsiveMenu } from "@/components/ui/responsive-menu";
import { notify } from "@/components/ui/sonner";
import { Tooltip } from "@/components/ui/tooltip";

const fail = (err: unknown) => {
  notify.error(errorText(err));
};

/**
 * Keep, on the person's own entry from a subscription whose retention could remove it: with none,
 * the subscription keeps every video and Keep would change nothing.
 */
const offersKeep = (item: LibraryItem) =>
  item.sharedBy === null && item.subscription?.hasRetention === true;

/**
 * The watch page's ⋮ menu (docs/library.md): Mark as watched and Mark as unwatched, the current one
 * checked (neither on a video started but not finished). Mark as unwatched forgets where the person
 * was and starts the video over (`onStartOver` takes the open player back to the start, paused, so
 * it doesn't save the old place again). Keep, checked while kept, where it matters; Edit details on
 * a video of the person's own (`onEdit`, docs/library.md#your-own-details); Open on original site;
 * Refresh SponsorBlock segments on the owner's video whose profile skips some
 * (docs/automation.md#sponsorblock), whose outcome the live stream's toast reports (`LiveEvents`);
 * and, last and in danger text, Remove on the person's own entry (`onRemove`, which asks first).
 */
export function ItemMenu({
  item,
  onStartOver,
  onEdit,
  onRemove,
}: {
  item: LibraryItem;
  /** Mark as unwatched: the open player goes back to the start. */
  onStartOver?: (() => void) | undefined;
  /** Edit details: opens its dialog; none where the person may not edit them. */
  onEdit?: (() => void) | undefined;
  /** Remove: asks, then removes the entry; none on a video shared with the person. */
  onRemove?: (() => void) | undefined;
}) {
  const client = useQueryClient();
  const watched = item.progress?.watched ?? false;
  /** Unwatched with nowhere to forget: picking Mark as unwatched would change nothing. */
  const fresh = !watched && (item.progress?.position ?? 0) <= 0;
  const markWatched = (to: boolean) => () => {
    if (to ? watched : fresh) return;
    if (!to) onStartOver?.();
    setWatched(item.id, to)
      .then(() => client.invalidateQueries({ queryKey: ["api", "library"] }))
      .catch(fail);
  };
  const actions: MenuAction[] = [
    { label: "Mark as watched", icon: Eye, checked: watched, onSelect: markWatched(true) },
    { label: "Mark as unwatched", icon: EyeOff, checked: fresh, onSelect: markWatched(false) },
  ];
  if (offersKeep(item)) {
    actions.push({
      label: "Keep",
      icon: Pin,
      checked: item.kept,
      separated: true,
      onSelect: () => {
        setKept(item.id, !item.kept)
          .then(() => client.invalidateQueries({ queryKey: itemKey(item.id) }))
          .catch(fail);
      },
    });
  }
  const more: MenuAction[] = [];
  if (onEdit !== undefined) more.push({ label: "Edit details", icon: Pencil, onSelect: onEdit });
  if (item.webpageUrl !== null) {
    more.push({
      label: "Open on original site",
      icon: ExternalLink,
      href: item.webpageUrl,
      external: true,
    });
  }
  if (item.sponsorSegmentsRefetchable) {
    more.push({
      label: "Refresh SponsorBlock segments",
      icon: RefreshCw,
      onSelect: () => {
        refetchSkipSegments(item.id)
          .then(() => {
            notify.info("Fetching SponsorBlock segments");
          })
          .catch(fail);
      },
    });
  }
  const [first, ...rest] = more;
  if (first !== undefined) actions.push({ ...first, separated: true }, ...rest);
  if (onRemove !== undefined) {
    actions.push({
      label: "Remove",
      icon: Trash2,
      destructive: true,
      separated: true,
      onSelect: onRemove,
    });
  }
  return (
    <ResponsiveMenu
      title="More actions"
      actions={actions}
      trigger={
        <Tooltip label="More actions">
          <Button variant="icon" size="icon" aria-label="More actions">
            <MoreVertical aria-hidden />
          </Button>
        </Tooltip>
      }
    />
  );
}
