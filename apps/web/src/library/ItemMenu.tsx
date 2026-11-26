import type { LibraryItem } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, ExternalLink, MoreVertical, Pin, RefreshCw } from "lucide-react";

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
 * checked; Keep, checked while kept, where it matters; Open on original site; and Refresh
 * SponsorBlock segments on the owner's video whose profile skips some
 * (docs/automation.md#sponsorblock), whose outcome the live stream's toast reports (`LiveEvents`).
 */
export function ItemMenu({ item }: { item: LibraryItem }) {
  const client = useQueryClient();
  const watched = item.progress?.watched ?? false;
  const markWatched = (to: boolean) => () => {
    if (to === watched) return;
    setWatched(item.id, to)
      .then(() => client.invalidateQueries({ queryKey: ["api", "library"] }))
      .catch(fail);
  };
  const actions: MenuAction[] = [
    { label: "Mark as watched", icon: Eye, checked: watched, onSelect: markWatched(true) },
    { label: "Mark as unwatched", icon: EyeOff, checked: !watched, onSelect: markWatched(false) },
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
