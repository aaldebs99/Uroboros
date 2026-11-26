import type { LucideIcon } from "lucide-react";

import { errorText } from "@/api/client";
import type { MenuAction } from "@/components/ui/responsive-menu";
import { notify } from "@/components/ui/sonner";
import { isInstalled, isIos } from "@/push/installed";

/**
 * Saving from the installed iPhone or iPad app (docs/downloads.md#saving-a-file). Following a link
 * to the file there hands the app's only page to iOS's file view with no way back (WebKit bug
 * 290847), and a window the app opens is an in-app Safari sheet that can't download (it shows a
 * blank page). So Save hands Safari itself the file, through its `x-safari-https:` scheme (iOS 17
 * and later, undocumented). iOS has no `x-safari-http:`, so on an http address (a LAN install)
 * Save stays the plain download link. Safari may not have the app's cookies, so what it gets is a
 * save link,
 * which needs none; its token is chosen here, so the link is known inside the tap, and registered
 * with the server alongside (the server waits a moment for a link Safari asks for first).
 */

/**
 * Whether Save hands the file to Safari: only in the installed iPhone or iPad app, and only on an
 * https address, the only one Safari's scheme takes.
 */
export const savesInWindow = (): boolean =>
  window.location.protocol === "https:" && isIos() && isInstalled();

/** The hand-off's navigation, which tests replace (jsdom goes nowhere). */
export const navigation = {
  go(url: string): void {
    window.location.href = url;
  },
};

/** How long the app waits to be put away by Safari before saying the hand-off didn't happen. */
const HANDOFF_MS = 1500;

/** A save link's token: 32 random bytes in base64url, as the server makes its own. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Opens `url` (absolute https) in Safari, never in a window of the app's own, which iOS shows as the
 * in-app sheet that can't save. Safari puts the app away; an app still in front after `HANDOFF_MS`
 * (an iOS before 17) says so.
 */
export function openOutside(url: string): void {
  navigation.go(`x-safari-${url}`);
  window.setTimeout(() => {
    if (document.visibilityState === "visible" && document.hasFocus()) {
      notify.error("Couldn't open Safari to save the file", {
        detail: "It needs iOS 17 or later; save it from Safari instead.",
      });
    }
  }, HANDOFF_MS);
}

/**
 * Saves through a save link: chooses its token, registers it with `register` (which should keep the
 * request alive as the app is put away) and hands the link over at once, inside the tap.
 */
export function openSave(register: (token: string) => Promise<unknown>): void {
  const token = newToken();
  register(token).catch((err: unknown) => {
    notify.error(errorText(err));
  });
  openOutside(new URL(`/api/public/saves/${token}`, window.location.origin).href);
}

/** A Save menu row: the file as a download link, or in the installed iPhone app handed to Safari. */
export function saveAction(
  label: string,
  icon: LucideIcon,
  href: string,
  register: (token: string) => Promise<unknown>,
): MenuAction {
  return savesInWindow()
    ? {
        label,
        icon,
        onSelect: () => {
          openSave(register);
        },
      }
    : { label, icon, href };
}
