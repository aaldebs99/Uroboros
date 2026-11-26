import type { LucideIcon } from "lucide-react";

import { errorText } from "@/api/client";
import type { MenuAction } from "@/components/ui/responsive-menu";
import { notify } from "@/components/ui/sonner";
import { isInstalled, isIos } from "@/push/installed";

/**
 * Whether Save opens a window of its own (docs/downloads.md#saving-a-file): in the installed iPhone
 * or iPad app, where following a link to the file hands the app's only page to iOS's file view with
 * no way back (WebKit bug 290847). Everywhere else Save stays a plain download link.
 */
export const savesInWindow = (): boolean => isIos() && isInstalled();

/**
 * Saves through a window of its own: opened at once, inside the tap (iOS allows a window only then),
 * then sent to the save link `link` makes, which needs no cookie, since the window may not have the
 * app's. The app's own page never navigates.
 */
export function openSave(link: () => Promise<string>): void {
  const win = window.open("", "_blank");
  if (win === null) {
    notify.error("Couldn't open a window to save the file");
    return;
  }
  link()
    .then((url) => {
      win.opener = null;
      win.location.href = new URL(url, window.location.origin).href;
    })
    .catch((err: unknown) => {
      win.close();
      notify.error(errorText(err));
    });
}

/** A Save menu row: the file as a download link, or in the installed iPhone app a window of its own. */
export function saveAction(
  label: string,
  icon: LucideIcon,
  href: string,
  link: () => Promise<string>,
): MenuAction {
  return savesInWindow()
    ? {
        label,
        icon,
        onSelect: () => {
          openSave(link);
        },
      }
    : { label, icon, href };
}
