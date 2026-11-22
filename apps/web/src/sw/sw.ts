/// <reference lib="webworker" />
/**
 * The service worker: the shell precached so the installed app opens with no connection, and
 * Uroboros's pushes shown and opened. Built by vite-plugin-pwa's `injectManifest` into `sw.js`; in
 * dev, `vite.config.ts` serves one that removes itself instead. Typed by `tsconfig.sw.json`.
 */
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

import { noticeOf, targetOf } from "../push/notice";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] };

// A new version takes over at once (`registerType: "autoUpdate"`).
void self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// Client-side routes fall back to the cached shell; the API never does, and nothing is cached at
// run time, so `/api` always goes to the network.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/^\/api\//] }),
);

/** A push's JSON, or `null` when it carries none or something else. */
function pushData(event: PushEvent): unknown {
  try {
    return event.data?.json() ?? null;
  } catch {
    return null;
  }
}

// Always show something: a push that shows nothing gets the subscription revoked.
self.addEventListener("push", (event) => {
  const notice = noticeOf(pushData(event), self.location.origin);
  event.waitUntil(
    self.registration.showNotification(notice.title, {
      body: notice.body,
      icon: "/pwa-192x192.png",
      badge: "/pwa-64x64.png",
      data: { navigate: notice.navigate },
      ...(notice.tag === undefined ? {} : { tag: notice.tag }),
    }),
  );
});

/** Focuses an open window of the app and moves it to `target`, else opens one there. */
async function open(target: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows[0];
  if (existing) {
    await existing.focus();
    await existing.navigate(target).catch(() => undefined);
    return;
  }
  await self.clients.openWindow(target);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { navigate?: unknown } | null;
  const navigate = typeof data?.navigate === "string" ? data.navigate : "/";
  event.waitUntil(open(targetOf(navigate, self.location.origin)));
});
