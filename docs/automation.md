# Automation: subscriptions, retention and the reaper

Uroboros keeps itself up to date and tidy: it follows channels and playlists, downloads what is
new, cuts sponsor segments, and clears out what nobody wants any more. Downloads and storage are
in [downloads.md](downloads.md), the library in [library.md](library.md).

## Subscribing

A subscription is made from the preview downloads already use (`src/subscriptions/`). The way in
is Subscriptions › **Add subscription**: paste a channel or playlist link and the app goes straight
to the new subscription's settings (`/subscriptions/new?request=…`), which wait there while the
link is looked at. That request is marked `intent: "subscribe"`, so a single video is refused
(`not_a_feed`) instead of downloaded. A link pasted to download shows a preview on the Downloads
page, which offers **Subscribe** beside queueing entries. The probe
records the source (a channel's id with its videos' extractor, so the subscription's channel key
matches the library's channel page; a playlist's id with its listing's extractor) and each group's
listing URL (a channel's tabs, or the playlist). A channel's main URL lists under its handle
(`@name`), so the channel id comes from the listing's `channel_id`: subscribing through the main
URL and through `/videos` is the same source.

`POST /api/subscriptions` takes the request id, the tabs to follow, a format profile, a check
interval, filters, a wait, what to do with the videos already there, retention and whether to
notify. Each person follows a source once (a second is 409). `PATCH` edits everything but the
backfill choice; `DELETE` unsubscribes (below); `POST /{id}/check` checks now; `GET /{id}/items`
pages through what the subscription saw, newest first. Everything is the caller's own: another
person's subscription is 404, admins included.

## Checks

Each enabled subscription keeps when its next check is due (`next_check_at`). Every 5 s the leader
queues the due ones on the `automation` queue (`src/subscriptions/due.ts`, as Djinn's scheduler
does). It claims each with a conditional update that moves its next check on, so a pass racing
another queues nothing twice, and runs missed meanwhile are skipped, never replayed. A scheduled
check shares the `check|<id>` key with "check now", so one that falls due while another waits or
runs is absorbed. A subscription's schedule (`CheckSchedule`, `src/subscriptions/schedule.ts`) is
one of:

- **Every N minutes** (`interval_minutes`), from `UROBOROS_MIN_CHECK_INTERVAL_MINUTES` (default 60)
  to a week, counted from each check's due time; a new subscription's first check runs at once.
  After an edit or a resume, the next check is due an interval after the last one (or at once).
  The web app writes it as a number of
  minutes, hours or days (6 hours by default).
- **A cron** (`cron`, `cron_tz`): a standard 5-field expression (minute, hour, day of month, month,
  day of week; no seconds) in an IANA timezone, the browser's by default. It is parsed with
  `cron-parser` and refused when any two of its next 200 runs are closer than the
  minimum interval, so `0,1 9 * * *` is as refused as `*/5 * * * *`. It first runs at its next
  time.

Pausing clears the next check and resuming sets it again. The subscriptions of a disabled or
revoked account are never queued. The API's `nextCheckAt` is the column.

Every replica consumes `automation`, two checks at a time, with a queue-wide limiter of one check
start per two seconds. A check (`src/subscriptions/check.ts`):

1. Takes the subscription's 15-minute lease (an `UPDATE ... RETURNING` that only succeeds while no
   other check holds it, the subscription is enabled and its owner active), renewed between feeds
   and probes. A second check at the same time returns at once.
2. Lists each followed feed flat, capped at `UROBOROS_MAX_PLAYLIST_ENTRIES` from the top (a channel
   tab lists newest first, so the cap keeps the newest). A playlist that reaches the cap sets the
   subscription's warning: only its first N entries are followed. A playlist subscription also
   records the playlist as one of its owner's YouTube playlists, with the listed positions
   ([sharing.md](sharing.md)), so it shows under Playlists and can be shared.
3. Skips videos with a final outcome in `subscription_items`, the seen set. `waiting` ones come
   back, except those held by the wait, which are left alone until their time.
4. Primes each feed on its own first check. On the subscription's very first check the backfill
   applies: **none** records every listed video as `existing`, **newest** lets each tab's newest N
   through (channels only: a playlist's order says nothing about age), **all** lets them all
   through. A tab followed later primes with none.
5. Filters what is left (`filters.ts`, `decisions.ts`), then queues it. Under the subscription's
   row lock it first checks that the filters did not change while it ran; if they did, it records
   nothing, frees the lease and queues a check under the new filters.
6. Records how it went, frees the lease, and resets or counts the failures in a row. Priming sets
   `primedAt` in SQL on the row's own feeds, so a tab added or removed while the check ran stays as
   edited. A check cut by shutdown records nothing and frees its lease; the schedule runs it again.

### Filters, in order

- A private entry is filtered as unavailable; an upcoming or live-now one waits ("upcoming", "live
  now") whatever the filters say, since it cannot be fetched yet.
- With **exclude live**, a finished live stream is filtered.
- **Title patterns** (include and exclude) are Postgres regular expressions, matched
  case-insensitively in one query over the batch, never in Node: a backtracking pattern would
  freeze a replica that also serves HTTP. They run under a 5 s `statement_timeout`; a pattern that
  takes longer fails the check with "a title pattern took too long". Patterns are checked by
  Postgres when saved (an invalid one is 400), and a `\b` or `\B` outside brackets is stored as
  `\y` or `\Y`, Postgres's word boundary (its `\b` is a backspace).
- **Duration** bounds, an **uploaded on or after** date, and (playlists only) **exclude Shorts** by
  a `/shorts/` URL or yt-dlp's `media_type`. A channel leaves Shorts out by not following its
  Shorts tab.

The listing decides whatever it can. When a filter needs a field the listing lacks (YouTube's
listings carry no upload date), the check probes that one video in full, at most 50 per check;
the rest are recorded `waiting` ("not checked yet") for the next check. A probe that fails for good
files the video as filtered: "unavailable" (removed, private), "age-restricted", "geo-blocked" or
"unsupported"; any other failure leaves it `waiting` ("could not be checked").

### The wait

With **wait before downloading**, a passing video waits until that many hours after Uroboros first
saw it, then queues on the first check after that. It is for SponsorBlock: segments are submitted
in the hours after a video goes up, and a brand-new video usually has none to skip. The backfill
skips it, since old videos already have their segments.

### Queueing

Passing videos go through `queueDownload` and `dispatchFor` like any other, with the
subscription's profile and id. The backfill is queued at priority 1 and everything else at 0, and
`dispatchFor` takes priority first, then age, so a backfill of hundreds never holds up a pasted link
or another subscription's new upload. An item remembers that it is backfill
(`subscription_items.backfill`), so a backfilled video decided on a later check (past the probe
budget, or after a filter edit) still queues at priority 1 and sends no notification. The fetch's settle copies the
subscription's id onto the library entry it creates. A video the person already has, or is already
getting, is recorded `queued` with no download.

Changing the filters sends the `filtered` items back to `waiting` ("filters changed") as backfill,
so the next check reconsiders those still listed under the new filters; `existing` and `queued`
items stay as they are.

### Download the latest

A subscription's page has **Download latest…**: `POST /api/subscriptions/{id}/latest {count}`
(1 to 50; a paused subscription is 409) adds a `latest` job on the `automation` queue
(`latest|<id>`, so one waiting absorbs another), since only job consumers run yt-dlp. The job
(`src/subscriptions/latest.ts`) takes the subscription's lease like a check (while a check holds it,
it tries again every 30 s), lists each followed feed signed in as the owner (a channel tab with
`--playlist-items=1:<count>`, its newest; a playlist in full, up to the cap, keeping its last
`count` entries), and queues them at priority 0, past the filters and the wait: they were asked
for. Their items become `queued` whatever they were before; a video the person already has, or is
getting, gets no new download. It sends no notification.

The **newest** backfill chosen when subscribing takes at most 50 of each tab as well.

The subscription page's **Recent activity** opens each video on its site (its title, in a new
tab), offers **Watch** for one in the library, and **Download** beside one the subscription passed
over (skipped, filtered or waiting): `POST /api/subscriptions/{id}/items/download {extractor,
videoId}` queues that video in the subscription's format at a pasted link's priority, from the
item's own link (no yt-dlp in the request), and the item turns `queued`. One already had or on its
way counts as skipped.

## SponsorBlock

The categories to get rid of (`sponsor`, `intro`, `outro`, `selfpromo`, `preview`, `filler`,
`interaction`, `music_offtopic`) live in the format profile, which already says what shapes a file:
its owner ticks them in the profile editor. The built-ins, and a new profile in the editor until its
owner changes it, take `sponsor`, `selfpromo` and `interaction`. The categories join the profile's
revision only when there are any (so profiles without them kept their revisions), and the file is
shared by everyone using the profile and revision. What happens to the segments depends on the file
(`ytdlpArgsFor`, `src/downloads/profiles.ts`):

- **A video keeps them** and the player skips them. Downloads run `--sponsorblock-mark=<categories>`,
  which embeds them as chapters ("[SponsorBlock]: Sponsor") by a stream-copy remux. The fetch reads
  the segments yt-dlp found from the `.info.json` (`sponsorblock_chapters`) into
  `renditions.skip_segments` (`src/worker/skipSegments.ts`: the profile's categories, SponsorBlock's
  "skip" action). The item and public-link routes hand them out as `skipSegments`, and the web player
  draws them as bands on the timeline and jumps over one when playback runs into its start, with an
  Undo (`apps/web/src/library/SponsorSkip.tsx`). Only playback skips: a segment the viewer seeks
  into plays out, and a jump of more than 2 s between two looks counts as a seek. Cutting a video is what yt-dlp's
  `--sponsorblock-remove` would do, but it cuts by stream copy: each kept part must restart at the
  keyframe before its cut point, so up to one keyframe interval of the removed segment (several
  seconds on YouTube's AV1) comes along. Those packets land before the part's start, the muxer
  stacks them on one timestamp, and the browser plays their audio over the next scene, out of sync
  from then on. A whole file also keeps `media.chapters` on its timeline.
- **An audio file has them cut out**: audio-only profiles run `--sponsorblock-remove=<categories>`.
  Every audio packet starts a part cleanly, so the cut is exact, and a music player that knows
  nothing of SponsorBlock never plays them. Its rendition has no `skip_segments`.

To save a video to a device without its segments, the item page's Save offers a copy re-encoded
without them, cut exactly and in sync
([transcoding.md](transcoding.md#saving-without-sponsorblock-segments)).

Exact cuts in the stored video need a re-encode too: extra arguments `--sponsorblock-remove=…
--force-keyframes-at-cuts` do that, with ffmpeg's default encoder for the container, slowly and at
a cost in quality. `--remove-chapters` and `--download-sections` cut by stream copy too, with the
same keyframe limit, unless `--force-keyframes-at-cuts` comes with them.

## Unsubscribing

Deleting a subscription removes its schedule and its seen set, cancels its downloads that have not
been dispatched yet, and leaves its library entries in the library as ordinary entries.

## Notifications

The `notify` queue's consumer (`src/worker/notify.ts`) sends each job through `Pusher.notify`, and
drops it while push is off. A check that queued at least one video outside a backfill sends "N new
videos from <subscription>" (one: "New from <subscription>") with the first three titles, opening
the subscription's page; a newer one replaces it (tag `subscription-<id>`). The third failed check
in a row sends "<subscription>: checks are failing" at high urgency, once per failing streak.
Each subscription can turn its notifications off.

## Retention and Keep

The leader applies retention hourly (`src/subscriptions/retention.ts`), to entries the subscription
brought, in that person's library:

- **Keep only the newest N**, by upload date, then when added.
- **Remove watched after D days**, counted from `watch_progress.watched_at`, the moment the video
  first counted as watched (unwatching clears it).

An entry marked **Keep** (`PUT /api/library/{id}/kept`; a switch on the item page of an entry from
a subscription) neither counts toward N nor goes, and neither does one in one of its owner's
playlists or shared on its own ([sharing.md](sharing.md)); one reached only through a shared
YouTube playlist still counts. Removing means deleting the library entry (its
tags go with it); the video stays in the seen set, so it is not downloaded again, and its file is
the reaper's.

## The reaper

The leader runs the reaper every 15 minutes (`src/storage/reaper.ts`), mark and sweep:

1. A rendition no entry references is marked (`orphaned_at`), and one that gained an entry again is
   unmarked.
2. A rendition marked more than 24 hours ago is swept: under its row lock it is checked again (in
   a new statement, so an entry committed while waiting counts) for entries and for an active
   download of its fetch key, then deleted, its key moved to `storage_trash` in the same
   transaction. `library_entries.rendition_id` is `ON DELETE RESTRICT`, so a delete racing a new
   entry fails rather than taking the entry with it, and the two places that link an entry to a
   stored rendition (`queueDownload` and the fetch's settle) lock it `FOR KEY SHARE` first: they
   wait for the reaper and then see the rendition gone and fetch anew, or hold it until their
   entry is committed.
3. Media with no renditions, untouched for 24 hours and with no active download, go the same way;
   their thumbnail, info JSON and subtitle keys go to the trash.
4. Trashed files are deleted, then their trash rows; a failed delete stays for the next pass. A key
   some row uses again (folder-layout keys repeat when a video comes back) is only dropped from the
   trash, and a new file never takes a key still in the trash. On the filesystem backend a delete
   also removes the folders it leaves empty, never the root.

The 24 hours are an undo window: queueing a removed video again within it links the stored file
at once. Removing an entry by hand frees its file the same way.

## Configuration

`UROBOROS_MIN_CHECK_INTERVAL_MINUTES` (60): the shortest check interval a subscription may have.
`UROBOROS_MAX_PLAYLIST_ENTRIES` (1000) also caps each feed's listing.
