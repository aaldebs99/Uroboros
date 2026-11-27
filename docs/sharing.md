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

`PUT /api/playlists/{id}/hidden` keeps a playlist of either kind out of the library, or lets it
back, for the caller alone (a YouTube one on their own `user_sources` row); `hideFromLibrary` says
which ([library.md](library.md#hiding-from-the-library)).

`POST /api/playlists/{id}/copy` is **Save as my playlist**: a manual playlist of the person's
videos from either kind, in its order. On the watch page, `?list={id}` plays a playlist in order:
Up next replaces the suggestions and the end of a video opens the next.

## Sharing

A share (`shares`) is one thing (a library entry, a manual playlist, or a YouTube playlist the
owner has) in one of two modes; each thing has at most one of each mode per owner, each with its
own optional expiry. `PUT /api/shares/{kind}/{id}/people` and `…/link` set them, `DELETE` stops
them, `GET /api/shares/{kind}/{id}` says how a thing is shared, and `GET /api/shares` lists
everything the caller shares (Shared › By me), expired ones included and marked.

**With people** (`share_people`): named accounts, and the owner's [groups](#groups). A share to a
group reaches everyone in it at the moment they ask, never the owner, so someone added later sees
what was already shared and someone who leaves stops seeing it; it counts only while the owner is
still in the group, and leaving (or being removed) ends your shares to it. A people-share left
with nobody (its only group deleted, its only person's account deleted) ends, by a deferred
trigger. Naming yourself, an unknown or a disabled account, or a group you are not in is 400; the
group check runs under a lock on the groups (`FOR KEY SHARE`), so a leave or a delete at the same
moment can't slip past it. `GET /api/directory` lists the other enabled accounts and the caller's
groups for the share dialog, so every member can see the account list (a household or small team).
The sign-in provider's groups (`users.groups`) decide only the admin role ([auth.md](auth.md)).

**By public link**: a code of 128 random bits in base64url, stored as it is so the owner can copy
the link again at any time. Turning the link off deletes it; turning it on again makes a new code,
so an old copy never comes back. The request log records a link's path with `…` in place of its
code (`src/api/logPath.ts`), so reading the logs opens no link. **Allow downloads** decides whether the page offers the file: it
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

## Groups

Anyone signed in makes a group (`groups`, `group_members`; `src/groups/`): a name of 1–100
characters, not unique (two households can each have "Family"). Its maker is its first manager.

- **Members** see the group, everyone in it (who manages it, who is disabled) and what its members
  share with it (`GET /api/groups/{id}/shares`, theirs marked `mine`), share with it themselves,
  and leave. Someone outside a group gets 404 for it, the same as for one that doesn't exist.
- **Managers** rename it, add enabled accounts (who join at once and get "_Name_ added you to
  _group_" if their Groups notices are on; anyone already in is skipped), make members managers and
  back, remove people (which ends that person's shares to the group) and delete it (which ends
  what was shared only with it). A member who isn't a manager gets 403.
- **A group keeps an enabled manager**: the last one can't leave or step down while another
  enabled member remains (409). When a manager's account is deleted or disabled, the earliest-added
  enabled member becomes one (`ensure_group_manager`, from triggers on `group_members` and on
  `users.disabled_at`), and the last member going deletes the group. A disabled member stays in it
  but isn't reached by its shares and can't be made a manager.
- **Caps**: 500 people per group, and 50 groups made per person, counting only those they are
  still in (under `lockKey("GRPS", userId)`). Every change locks the group's row first, so the caps
  and the manager rule hold when two people act at once.
- **Admins** list every group (`GET /api/admin/groups`: name, members, managers) and delete any;
  they never see what is shared with one.

The web app lists them under Settings › Groups, each with its own page; Admin › Groups is the admin
view.

## Public links

`/api/public/s/{code}` is outside the auth guard (`src/sharing/publicRoutes.ts`); every route checks
its code itself and answers `X-Robots-Tag: noindex`:

- `GET /api/public/s/{code}`: the link's title, description, whether it allows downloads, and its
  videos (`PublicShare`). It never names who shared it.
- `GET …/items/{id}`: one video with its chapters, subtitles, codecs and URLs, all under the link
  (`PublicItem`), and its SponsorBlock segments by the link owner's setting, whoever opens it
  ([automation.md](automation.md#sponsorblock)); `…/stream`, `…/thumbnail`, `…/subtitles/{subId}`,
  `…/file` (the original file, segments and all; 404 unless downloads are allowed), and the playback sessions' `…/playback` and `…/playback/sessions/{sid}/…`, the same
  routes as a library entry's (`registerSessionScope`, [transcoding.md](transcoding.md)). A link
  plays on at most 3 screens at once.

Every dead link (unknown, expired, turned off, owner disabled) answers the same 404, "this link
doesn't work any more". With `UROBOROS_S3_PUBLIC_URL` set, the stream redirects to a presigned URL
that lives 15 minutes, so a link turned off meanwhile still plays out that URL.

The web app's `/s/{code}` sits outside the sign-in gate, in a plain frame (`PublicLayout`), and plays
with the same player (chapters, subtitles, a playback session where the browser can't play the
file, and the Quality menu); a playlist plays in
order. For link previews in chats, whose crawlers run no script, the SPA handler fills that page's
`<title>` and Open Graph tags (title, description, thumbnail, `og:url`) from the share, escaped,
with absolute URLs on `UROBOROS_PUBLIC_BASE_URL` (else the request's origin), plus a robots
`noindex`.

## Clips

A clip is a range of a video picked in the player (the Clip button; [library.md](library.md#the-item-page)):
a start and an end, at least a second apart. Nothing is stored until it is saved or shared.

- **Saving** one makes a copy of just that range, cut by the server, under Downloads › Copies to
  save ([transcoding.md](transcoding.md#clips)). A viewer of a video shared with them can save a
  clip of it too.
- **Sharing** one is for a video of the person's own. The Share dialog asks what is shared:
  - **Only the clip** (the default): its copy, made at the first share action and shareable while
    it is being made, shares with people and groups or by a public link like a video, through the
    same routes as kind `clip` with the copy's id (`src/sharing/clipShares.ts`), into `clip_shares`
    and `clip_share_people`. Its people open it at `/shared/clips/{id}` (`GET /api/clips/{id}`, and
    its `…/stream`, `…/file` and `…/thumbnail`, `src/clips/routes.ts`); a link's
    `/api/public/s/{code}` answers `kind: "clip"` with the clip (`ClipItem`), its file under
    `…/clip/stream`, `…/clip/file` (when the link allows downloads) and `…/clip/thumbnail`.
    Neither reaches anything else of the video: `visibleEntry` reads only `shares`. A clip has no
    description, since a video's own can list moments of all of it, and its chapters are the ones it
    overlaps, on its timeline. Removing the copy ends its shares, and Copies to save asks first.
    Retention keeps a video with a shared clip, as it keeps a shared video.
  - **The whole video, opened at the clip**: an ordinary share of the video. Its link carries the
    range (`/s/{code}?t=62&end=90`, and `/library/{id}?t=…&end=…` in the app), so the video opens at
    the clip, the player marks it and pauses at its end, and the viewer can watch the rest. The
    people it newly reaches hear of the clip (`PeopleShareBody.clip`); for people it already reaches,
    the dialog copies the range link to send them.
- **Rollout**: `clip_shares` is apart from `shares` because the release before reads every `shares`
  row as a video, playlist or YouTube playlist; it never reads `clip_shares`, so on it a clip link is
  a dead link and the lists leave clips out.
- **Off** (`UROBOROS_CLIPS_ENABLED=false`, read at start; `/api/info` says `clips`): the player has
  no Clip button and a range link opens at `t` only; asking for a clip copy, sharing a clip and a
  people-share with a `clip` are 409; clip links and `/api/clips/*` are 404, and With me and the
  group pages leave clips out. Copies already made still list and save, and owners still see and
  stop their clips' shares under By me.

## Notifications

Through `sendNotice` (`docs/push.md`): each is filed in the person's notification list, and pushed
unless the person turned the kind's pushes off in Settings › Notifications (`GET` and `PUT
/api/me/notifications`, all on by default; the list keeps them either way):

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
  already reached. A video shared opened at a clip says "shared a clip of _title_", with its range,
  and opens at it; a clip shared on its own says "shared _title_ (clip 1:02–1:30)" and opens its
  page ([Clips](#clips)). Under the share's tag, a later notice of a share replaces the earlier.
- **Groups**: "_Name_ added you to _group_", opening the group, to each person a manager adds.
  Joining a group sends no "shared with you" for what was already shared with it.

## The API document

`/api/docs` reads `/api/openapi.json`, whose overview explains tokens (`Authorization: Bearer`, the
routes a token cannot use, its scopes and read-only), the session cookie with the `X-Uroboros-CSRF` header, errors,
paging and the event stream. It declares both ways in (`bearerAuth`, `cookieAuth`) for every route
and marks the routes anyone may call with no security, so Swagger's **Authorize** takes a token and
"Try it out" works (`src/api/openapiDoc.ts`).
