# Playlists, sharing and notifications

How people show their videos to others: playlists of two kinds, sharing with people or by a public
link, and the push notifications that tell them what happened. The library is in
[library.md](library.md), push in [push.md](push.md), and subscriptions in
[automation.md](automation.md).

## Playlists

There are two kinds, listed together by `GET /api/playlists` (`PlaylistSummary`, with a `kind`):
the person's own playlists first (last changed first), then their YouTube playlists (last queued
first, only those holding at least one of their videos). `GET /api/playlists/{id}` answers either
kind; its videos are `GET /api/library?playlist={id}` (manual) or `?source={id}` (YouTube), in
order.

- **Manual playlists** (`playlists`, `playlist_items`) are made by hand: `POST /api/playlists`
  (a name of 1–100 characters, an optional description, optional videos), `PATCH` to rename,
  `DELETE` (the videos stay in the library). `POST …/items` adds videos at the end (skipping ones
  already in it), `PUT …/items` sets the whole order (anything left out leaves), `POST
  …/items/{entryId}/move` moves one (the web app's Move up and Move down, since a full order of a
  long playlist would not fit in a request body), `DELETE …/items/{entryId}` takes one out. A
  playlist holds at most 5000 videos, each once, and only its owner's: composite keys make an item
  of someone else's entry impossible. Removing a video from the library takes it out of every
  playlist.
- **YouTube playlists** are read-only and in YouTube's order (`sources`, `user_sources`,
  `source_items`). Queueing a playlist from a preview records one, and so does every check of a
  subscription to a playlist (`src/subscriptions/check.ts`): the check upserts the positions it
  listed and leaves the others, so a listing cut at `UROBOROS_MAX_PLAYLIST_ENTRIES` never drops the
  tail. Channel subscriptions record nothing.

`POST /api/playlists/{id}/copy` is **Save as my playlist**: a manual playlist of the person's
videos from either kind, in its order. On the watch page, `?list={id}` plays a playlist in order:
Up next replaces the suggestions and the end of a video opens the next.

## Sharing

A share (`shares`) is one thing (a library entry, a manual playlist, or a YouTube playlist the
owner has) in one of two modes; each thing has at most one of each mode per owner, each with its
own optional expiry. `PUT /api/shares/{kind}/{id}/people` and `…/link` set them, `DELETE` stops
them, `GET /api/shares/{kind}/{id}` says how a thing is shared, and `GET /api/shares` lists
everything the caller shares (Shared › By me), expired ones included and marked.

**With people** (`share_people`): named accounts, and groups. A group is a name from the sign-in
provider's groups claim, as stored on each SSO account (`users.groups`, refreshed at sign-in and by
the claims sync); a share reaches everyone whose groups hold it at the moment they ask, so joining
or leaving a group in the provider applies without touching shares. Local accounts belong to no
group. Naming yourself, an unknown or a disabled account is 400. `GET /api/directory` lists the
other enabled accounts and the groups in use for the share dialog, so every member can see the
account list (a household or small team).

**By public link**: a code of 128 random bits in base64url, stored as it is so the owner can copy
the link again at any time. Turning the link off deletes it; turning it on again makes a new code,
so an old copy never comes back. **Allow downloads** decides whether the page offers the file: it
is a button, not a lock, since anyone who can play a video can save its stream.

**Who may see an entry** (`src/sharing/access.ts`): its owner, or a viewer reached by a live share
that holds it. Live means not expired and its owner neither disabled nor revoked. A share holds an
entry when it names it, when its manual playlist holds it, or when its YouTube playlist lists the
entry's video and the entry is the owner's. Every route that serves an entry (`GET
/api/library/{id}`, its stream, file, thumbnail, subtitles, progress, watched state and compatible
copy) asks this one question; Keep, tags and removal stay the owner's. Shares follow what they
point at: removing a video ends its share, a playlist share shows the playlist as it is now, and
deleting a playlist ends its shares.

**What a recipient gets**: Shared › With me (`GET /api/shared`) lists live shares reaching them,
never their own. A shared video opens on the watch page with "Shared by …", Watched and Save; a
shared playlist on `/shared/{shareId}` (`GET /api/shared/{shareId}` and `…/entries`, a library
page of the owner's videos with the recipient's own progress, which is per person and media). The
owner's tags, Keep, subscription and playlists never show. **Add to my library** (`POST
/api/library/{id}/add`) gives the recipient their own entry on the same stored file at once (an
existing one on that file is answered as it is); **Save as my playlist** (`POST
/api/shared/{shareId}/save`) does that for every video of a shared playlist and makes a manual
playlist of them in order.

**Retention**: a video in one of its owner's manual playlists, or shared on its own, is exempt like
Keep. A video reached only through a shared YouTube playlist is not, so a subscribed playlist with
"keep the newest N" still trims.

## Public links

`/api/public/s/{code}` is outside the auth guard (`src/sharing/publicRoutes.ts`); every route checks
its code itself and answers `X-Robots-Tag: noindex`:

- `GET /api/public/s/{code}`: the link's title, description, whether it allows downloads, and its
  videos (`PublicShare`). It never names who shared it.
- `GET …/items/{id}`: one video with its chapters, subtitles, codecs and URLs, all under the link
  (`PublicItem`); `…/stream`, `…/thumbnail`, `…/subtitles/{subId}`, `…/file` (404 unless downloads
  are allowed), and the compatible copy's `…/playback`, `…/playback/master.m3u8` and segments, the
  same routes as a library entry's (`registerPlaybackScope`). A link can therefore have each shared
  video converted once.

Every dead link (unknown, expired, turned off, owner disabled) answers the same 404, "this link
doesn't work any more". With `UROBOROS_S3_PUBLIC_URL` set, the stream redirects to a presigned URL
that lives 15 minutes, so a link turned off meanwhile still plays out that URL.

The web app's `/s/{code}` sits outside the sign-in gate, in a plain frame (`PublicLayout`), and plays
with the same player (chapters, subtitles, the compatible copy for Safari); a playlist plays in
order. For link previews in chats, whose crawlers run no script, the SPA handler fills that page's
`<title>` and Open Graph tags (title, description, thumbnail, `og:url`) from the share, escaped,
with absolute URLs on `UROBOROS_PUBLIC_BASE_URL` (else the request's origin), plus a robots
`noindex`.

## Notifications

Through the `notify` queue (`docs/push.md`), each kind switchable per person in Settings ›
Notifications (`GET` and `PUT /api/me/notifications`, all on by default):

- **Downloads**: one notification per pasted link, when the fetch consumer settles its last pending
  download (`src/downloads/requestNotices.ts`): "Ready: _title_" for one video (opening it), "_N_
  videos from _playlist_ are ready" for many, or "Failed: _title_" and "_k_ of _N_ downloads
  failed" at high urgency (opening the queue). Cancelled downloads count in neither. A conditional
  update of `download_requests.noticed_at` lets only one of two settles that finish together
  notify; queueing or retrying one of its downloads clears it, so the next finish notifies again.
  A request that finishes while the person is there (everything already stored, or cancelling the
  last pending download) sends nothing, and so do a subscription's downloads (its own "N new
  videos" covers them).
- **Shared with me**: "_Name_ shared _title_ with you" (or "the playlist _title_") to each person a
  people-share newly reaches when it is made or gains people, never the owner and never someone it
  already reached.

## The API document

`/api/docs` reads `/api/openapi.json`, whose overview explains tokens (`Authorization: Bearer`, and
the routes a token cannot use), the session cookie with the `X-Uroboros-CSRF` header, errors,
paging and the event stream. It declares both ways in (`bearerAuth`, `cookieAuth`) for every route
and marks the routes anyone may call with no security, so Swagger's **Authorize** takes a token and
"Try it out" works (`src/api/openapiDoc.ts`).
