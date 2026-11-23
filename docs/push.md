# Push notifications and the installed web app

Uroboros is an installable web app (a PWA), and it can push native notifications to the browsers
and phones a person turns them on for, through Web Push. This step builds the framework: the
manifest and icons, the service worker, the devices and their Settings section, the key, and the
sender. What gets pushed comes with the features that have news (a download that finished or
failed, a subscription that found something); each sends through the same `Pusher`. The design is
taken from Djinn's (`docs/design/push.md` there), ported in behaviour rather than code.

## The installable app

`apps/web/public/manifest.webmanifest` is static and linked from `index.html`, so the dev server
serves the same manifest as a build (iOS reads it when the icon is added to the Home Screen). Its
`id`, `start_url` and `scope` are `/`, it opens `standalone`, and its theme and background colour
is the shell's dark sidebar token (`#010611`, the `.dark` `--sidebar` in `index.css`), also in the
`theme-color` meta.

The icons are generated from `assets/logos/uroboros-transparent.svg`, the one source of truth.
`mise run icons` copies it to `apps/web/public/uroboros.svg` (the favicon) and runs a pinned
`@vite-pwa/assets-generator` through `pnpm dlx`, configured by `apps/web/pwa-assets.config.ts`:
transparent 64, 192 and 512 px icons, a 48 px `favicon.ico`, and a maskable 512 px and an Apple
180 px icon on the theme colour. The generator is not a dependency because it pulls in sharp, a
native module, for files that change only when the logo does. The output is committed; run the
task again after changing the logo.

## The service worker

`apps/web/src/sw/sw.ts` is built by vite-plugin-pwa's `injectManifest` strategy into `sw.js`, with
Workbox doing what a generated worker would: the shell precached (`precacheAndRoute`, with
`cleanupOutdatedCaches`), client routes falling back to the cached `index.html` through a
`NavigationRoute` whose denylist keeps `/api/` off it, nothing cached at run time (the API always
goes to the network), and `skipWaiting` with `clientsClaim`, so a new version takes over at once
(`registerType: "autoUpdate"`). Its own part is the push handlers.

`src/main.tsx` registers it with `registerSW({ immediate: true })` in production builds only. In
dev, Vite answers `/sw.js` with a worker that unregisters itself, empties Cache Storage and reloads
its tabs. Without it, a browser that once opened a production build on the same origin would keep
that build's worker, which answers every navigation from its cache; Vite would answer `/sw.js` with
`index.html`, an update the browser rejects, so nothing would ever clear it.

The api's SPA handler serves everything outside `assets/` (`index.html`, `sw.js`,
`manifest.webmanifest`, the icons) with `Cache-Control: no-store`, because those keep their names
across releases, and `assets/*` with `public, max-age=31536000, immutable`, because Vite
content-hashes them. A path with a file extension never falls back to `index.html`: a missing
`sw.js` is a 404, not a page the browser would try to register as a worker.

## What is pushed

The payload is WebKit's Declarative Web Push JSON:
`{"web_push": 8030, "notification": {"title", "body"?, "navigate", "tag"?}}`
(`apps/server/src/push/payload.ts`). Safari 18.4 and later shows it without running any code, so a
worker that fails no longer costs the subscription. The worker reads the same `notification` member
on older iOS and on every other browser (`apps/web/src/push/notice.ts`), and always shows
something, because a push that shows nothing gets the subscription revoked: the fallback title is
"Uroboros", the icon `pwa-192x192.png` and the badge `pwa-64x64.png`. An empty body or tag is left
out of the payload, and the title is never empty. A tap closes the notification, then focuses an
open window of the app and navigates it, or opens one; `navigate` is honoured only when it is on
the app's own origin, so a push can never send the app elsewhere.

Each push carries `TTL: 86400` (a day a push service may hold it for a device that is offline) and
an `Urgency`: `normal` for the test and routine news, `high` for failures once those are sent. A
link is absolute, built on `UROBOROS_PUBLIC_BASE_URL`.

Only the test is sent today (`POST /api/me/push/devices/{id}/test`, a tap opening Settings). The
`notify` BullMQ queue is declared in `QUEUE_NAMES` for the features to come; its processor arrives
with the first event, and sends with `Pusher.notify(userId, message, urgency)`, which pushes to all
of a user's devices.

## How a push is sent

Encryption (RFC 8291, `aes128gcm`) and the VAPID signature (RFC 8292) come from the `web-push`
package, which runs on Node's crypto. Djinn hand-rolled both only because its cargo-deny policy
banned OpenSSL; nothing like that applies here. The request itself is ours
(`apps/server/src/push/sender.ts`): `web-push`'s `generateRequestDetails` builds the body and
headers and `fetch` posts them, so redirects are never followed and one time limit (15 s) covers
the whole exchange.

The push service's answer decides the device's fate. A 2xx is delivered and stamps
`last_success_at`. A 404 or 410 means the subscription is gone, and the device is deleted. A 429 or
5xx with a `Retry-After` of at most 5 seconds is tried once more after that wait; anything else,
including a second busy answer, a network failure or a redirect, is a failure and stamps
`failed_at`. A stored device whose endpoint no longer passes the allowlist is deleted without being
posted to.

## The key

With `UROBOROS_VAPID_PUBLIC_KEY` and `UROBOROS_VAPID_PRIVATE_KEY` set, that pair signs every push;
both or neither must be set, and the api refuses to start when they are not one pair. With neither,
the first replica that needs a key generates one and inserts it into the single-row `vapid_keys`
table with `INSERT ... ON CONFLICT DO NOTHING`, then every replica reads the row back, so all of
them sign with the same key however many start at once. The key is read lazily, on the first push
request, because the api must not touch the database while it is being constructed (`gen` builds
it with none). Keep the key stable: changing it drops every browser's subscription.

## On only with an https public URL

Push is on when `UROBOROS_PUBLIC_BASE_URL` is an https URL, and off, with a warning at start-up,
otherwise: a notification needs a link to open, push services need a contact, and a service worker
needs a secure origin anyway. `UROBOROS_PUSH_SUBJECT` (a `mailto:` address or an https URL) is that
contact and defaults to the public URL. Nothing missing stops the api from starting; a malformed
value that is set does. While push is off, `GET /api/me/push` says so, registering and testing
answer 409, and turning a device off still works.

## The endpoint is a URL a person supplied

The server POSTs to whatever endpoint a browser hands over, so only `https` endpoints on the known
push services are taken (`UROBOROS_PUSH_ALLOWED_HOSTS`, by default Apple's `push.apple.com`,
Google's `fcm.googleapis.com`, Mozilla's `push.services.mozilla.com` and Microsoft's
`notify.windows.com`; a host matches when it is one of these or a subdomain of one). Plain `http`
is allowed on loopback alone, for tests. An endpoint with credentials in it is refused, and so are
keys of the wrong shape (`p256dh` a 65-byte uncompressed P-256 point, `auth` 16 bytes). A refused
subscription is a 400.

## Devices and who owns them

A device is one browser's subscription: a `push_devices` row with its endpoint (unique; subscribing
again on the same endpoint updates the row and clears an old failure), keys, a label, and when it
was added, last reached and last failed. A user may have `UROBOROS_PUSH_MAX_DEVICES` (10) of them;
one more is a 422 (`unprocessable`) until one is turned off. The label is trimmed and cut to 64
characters, and an empty one becomes "This device".

Every device belongs to the signed-in user (`currentPrincipal(c)` in
`apps/server/src/api/principal.ts`); `user_id` references `users` and goes with the account. API
tokens are refused on `/api/me/push*`, so a leaked token cannot point a person's notifications at
another endpoint. Registration takes a per-user transaction lock (`lockKey("PUSH", userId)`), so
parallel registrations cannot pass the cap. An endpoint another user already registered is a 409,
never a takeover. Turning a device off from another browser leaves a tombstone
(`push_device_tombstones`), which `GET /api/me/push/devices/status?endpoint=` reports as
`turnedOffElsewhere`, so that browser's next launch shows "Turned off from another device" instead
of quietly registering itself again; registering clears it. Signing out drops this browser's device
and unsubscribes it first (`apps/web/src/push/leave.ts`), so a shared browser neither keeps pushing
to the person who left nor blocks the next one.

The routes are `GET /api/me/push` (`PushView`: `enabled`, `publicKey`, `devices`, `maxDevices`),
`POST /api/me/push/devices` (`PushSubscriptionBody`, answering the `PushDevice`),
`DELETE /api/me/push/devices/{id}` (204) and `POST /api/me/push/devices/{id}/test`
(`{ outcome: "delivered" | "gone" | "failed" }`). Their shapes are in `packages/contract`.

## Subscriptions vanish

iOS drops subscriptions without notice, and a reinstall makes a new one. On every launch
`usePushSync` compares this browser's subscription and its stored device (`localStorage`,
`uroboros.pushDevice`) with the server's list (`apps/web/src/push/sync.ts`). It subscribes again
when the subscription is gone and permission still stands, registers again when the subscription
changed or the server forgot the device, and forgets the device locally once permission is
withdrawn. It never asks for permission, which needs a tap.

## The Settings section

Settings, Notifications, shows the state and the one action that fits it. With push off on the
server it says so. Otherwise it offers Turn on notifications, whose tap asks for permission,
subscribes and registers this browser; or it says why it cannot: an iPhone or iPad outside the
installed app (iOS 16.4 and later push only to the Home Screen app), a browser without Web Push, or
notifications blocked in the browser's settings. Below that is the list of devices, this one
marked, each with when it was last reached, Send test (the outcome is a toast) and Turn off.

Not here yet, and deliberately: Djinn's presence reporting (pushing only when no copy of the app is
on screen), which matters for chat replies and not for downloads, and per-event preferences, which
come with the events.

## Setting it up

The operator's part is an https `UROBOROS_PUBLIC_BASE_URL`, and optionally a fixed VAPID pair (any
Web Push key generator, for example `pnpm dlx web-push@4.0.0 generate-vapid-keys`) in
`UROBOROS_VAPID_PUBLIC_KEY` and `UROBOROS_VAPID_PRIVATE_KEY`. In the Helm chart these are
`publicBaseUrl`, `push.subject`, `push.vapid.publicKey` with `push.vapid.existingSecret` (the private
key from an existing Secret), `push.allowedHosts` and `push.maxDevices`.

On an iPhone (iOS 16.4 or later): open Uroboros in Safari, tap Share, then Add to Home Screen, and
open it from its icon; a Safari tab cannot subscribe, and neither can Chrome or Firefox on iOS. In
Settings, Notifications, tap Turn on notifications and allow them, then Send test with the phone
locked. On Android and desktop browsers the installed app is optional.

## Tests

No test reaches a real push service. The sender, the pusher and the routes post to a stub push
service on 127.0.0.1 (`apps/server/test/pushStub.ts`), which also decrypts what it receives with the
fake browser's keys, so the encryption is checked end to end. The key bootstrap is raced by eight
concurrent callers against a real Postgres. The web side tests the payload reader, the same-origin
rule, the iOS and installed checks, the launch-time repair and every state of the Settings section.
