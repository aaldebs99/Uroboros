# Downloads and storage

How a pasted link becomes a stored file in someone's library. Every replica serves HTTP and also
consumes the probe and download queues; yt-dlp runs only in those job consumers, never in a
request handler.

## Flow

1. `POST /api/downloads {url, profileId?, intent?}` records a `download_requests` row (`probing`)
   and adds `probe|<requestId>` to the `probe` queue. Without `profileId` the default format
   profile is used. `intent: "subscribe"` (Subscriptions › Add subscription) makes a single video
   fail as `not_a_feed` rather than download: the link was for a subscription. A link typed
   without a scheme is read as https (`twitch.tv/channel` is `https://twitch.tv/channel`,
   `WebLink` in the contract), and a scheme other than http or https is refused; yt-dlp follows the
   site's redirects from there, and a video keeps the address it ended up at.
2. A replica's probe consumer probes the link with `--flat-playlist` (`src/worker/probe.ts`):
   - a **video** upserts its `media` row, creates one `downloads` row and dispatches it; the
     request becomes `queued`. A media row is keyed by extractor and video id, and a stored
     rendition is reused by anyone who asks for that video with that profile. A site's own
     extractor reports the site's id, but yt-dlp's generic extractor (a link it has no extractor
     for) reports the file or page name, which anyone can give a file of their own. So a generic
     video's id also carries a hash of its link (`meeting~<16 hex>`, `src/library/mediaKey.ts`),
     in previews and subscription listings too, and a generic page's playlist (`sources`) the
     same way: two people's `…/meeting.mp4` links never share a file, two `…/videos.html` pages
     never share a playlist, and the same link is still the same video;
   - a **playlist** becomes `choosing`, with one preview group, every entry ticked;
   - a **channel's main URL** lists its tabs, each becoming a group (Videos ticked, Shorts and
     Live unticked): current yt-dlp nests every tab's entries in the root listing, which is then
     used as it is; a tab without them (an older yt-dlp's stub) is listed on its own;
   - a group is cut at `UROBOROS_MAX_PLAYLIST_ENTRIES` (1000), and says so. Every preview listing
     passes `--playlist-items=1:<that + 1>` (the cap applies to a root's nested tabs as well), so
     a channel with thousands of videos lists in seconds instead of paging through all of them;
   - a failure marks the request `failed` with its error kind and yt-dlp's redacted stderr tail,
     which the web shows collapsed ("yt-dlp output") under the error's plain words, as it does
     for a failed download. A site that wants a signed-in account (yt-dlp's login wall: Vimeo's
     own video pages need one with current yt-dlp) is `login_required`, and a saved login the
     site refused is `login_failed`; both point to Settings › Logins ([site logins](#site-logins)).
     Credentials are always a person's own: the server has no account of its own to sign in with.
3. `POST /api/downloads/requests/{id}/queue {entryIds}` turns the ticked entries into downloads.
   Entries the person already has, or is already getting, are skipped and counted. Until then the
   preview **waits for its pick**, held a day from when it was ready (the probe sets `expires_at`
   when it writes `choosing`, so a long probe doesn't eat into it):
   - the picker saves the person's ticks as they change (`PUT /api/downloads/requests/{id}/selection
     {entryIds}`, into `selected`; null until anything changed, when the groups' own ticks stand),
     so the preview opens with them again from another tab or device;
   - a pasted playlist or channel (`intent: "download"`, not a search's results or a link to
     subscribe to) is listed by `GET /api/downloads/requests` with how many entries it has, how
     many are picked and when it goes, and the bell shows it under "Ready to pick", counted on its
     badge, until it is queued or its day is up; so does the Downloads page, whose Pick opens it
     in the picker there. The probe, a saved pick and queueing publish
     `{ kind: "requests", userId }` on `uroboros_downloads`, and the person's open tabs fetch the
     list again. This is how a playlist added from the Ctrl+K palette (or the Download a link
     dialog, which close while the link is still being looked at) is found again;
   - past its day it reads as gone at once (404, so the picker says it expired), and the leader's
     sweeper deletes it within the hour.
4. Queueing a download (`queueDownload` in `src/downloads/dispatch.ts`) snapshots the profile's
   arguments and revision on the row. If the rendition is already stored, the download is `done`
   at once and a library entry is added; otherwise it waits as `queued`.
5. **Dispatch** (`dispatchFor`): under a per-user transaction lock, a person's oldest waiting
   downloads are dispatched until `UROBOROS_MAX_ACTIVE_DOWNLOADS_PER_USER` (3) of theirs are
   dispatched and active. Dispatching adds the fetch job ([jobs.md](jobs.md)) in the same
   transaction, keyed by the **fetch key** `fetch|<extractor>|<videoId>|<profileId>|<revision>`
   (each part URI-encoded). A second add of a live key does nothing, so two people asking for the
   same video and profile at once share one fetch. Whenever a download settles, its owner's next one is dispatched.
6. **Fetch** (`src/worker/fetch.ts`): in a scratch folder of the run's own ([Scratch
   space](#scratch-space)), yt-dlp downloads with the snapshot's arguments (plus a jpg thumbnail
   and the `.info.json`), ffprobe reads the codecs, and the file and its sidecars are moved to the
   store. ffmpeg picks a demuxer by a
   file's contents, not its name, so a link serving a DASH or HLS playlist as `video/mp4` would
   make it open whatever files or URLs the playlist names (another person's stored video, an
   internal address). Every ffmpeg and ffprobe input of a downloaded or stored file (this probe,
   playback, keyframes, hover previews, cut copies) is held to the media containers
   (`-format_whitelist`, `MEDIA_FORMATS` in `packages/ytdlp/src/mediaFormats.ts`) and to its
   protocols (the file protocol for a path). yt-dlp's own ffmpeg post-processors (merge, remux,
   embed, convert, cut) get the same through `--postprocessor-args <PP>+ffmpeg_i:…` for each of
   them, plus the subtitle, image and metadata formats they read (and `concat` for the two that
   cut or join through a concat list it writes). Then one transaction records
   the rendition (`ON CONFLICT DO NOTHING`), marks every download waiting on the fetch key `done`
   and adds their library entries. The scratch folder is removed whatever happens.
7. **Failures**: `network`, `timed_out`, `unknown` and `storage` retry up to 3 attempts with
   exponential backoff (the downloads stay `running`, `attempts` counts); every other kind, or the
   last attempt, marks them `failed` with a server message and the redacted stderr tail. A
   `rate_limited` one is never a failure: it waits out the site's cooldown ([Rate
   limits](#rate-limits)). A stalled job (a replica that died mid-job) runs again; one cut by a
   replica's shutdown goes back to the queue without spending an attempt; storage keys are deterministic and the rendition
   and library inserts are idempotent, so a rerun never duplicates anything.

**Searching YouTube** (the web's Ctrl+K palette) is a request too: `POST /api/downloads/search
{query}` records one with `intent: "search"` whose URL is YouTube's results page for the query,
videos only (`/results?search_query=…&sp=EgIQAQ%3D%3D`, which yt-dlp lists as a playlist). The
probe lists its top `YOUTUBE_SEARCH_RESULTS` (10) with `--playlist-items=1:10` and no saved logins,
into one unticked `YouTube` group, recording no playlist (`sources`). Queueing its entries leaves it
`choosing`, so the results download one by one from the same search; it expires like any preview.

A job can also vanish while downloads still wait on it: dropped after stalling too often, or when a cancel
or a finished fetch races someone else's dispatch of the same key. The api leader's reconciler
(`src/downloads/reconcile.ts`, every minute) adds the job back, from the row's snapshot, for every
active download dispatched more than two minutes ago whose job is gone, so nobody's slots are held
by work nobody will do. An aborted fetch that someone started waiting on during the cancel retries
instead of finishing quietly.

## Rate limits

A site that answers yt-dlp with a rate limit (`rate_limited`: an HTTP 429, "Too Many Requests",
YouTube's "rate-limited" or bot check) puts the site in a **cooldown** (`site_cooldowns`, by the
link's host without `www.`, `m.`, `mobile.` or `music.`; youtu.be is youtube.com;
`src/downloads/rateLimits.ts`). It lasts as long as the site said, when its message says
(`cooldownHintMs` in `@uroboros/ytdlp`: YouTube's "for up to an hour", "try again in 30 seconds",
a quoted Retry-After; yt-dlp never prints the response's headers), and otherwise an estimate that
doubles with each limit in a row: 5, 10, 20… minutes, up to 2 hours, and for subtitles (which nobody
waits on to watch) 15, 30, 60… minutes, up to 6 hours. A cooldown already running longer stands,
and the first run the site answers after it ends clears the count.

While a site cools down, nothing asks it anything: a fetch, a pasted link's probe, a
subscription check and a hover preview's download ([library.md](library.md#hover-previews)) each go
back to their queue for just after the cooldown (spread over 15 s), without spending an attempt,
and a run the site limits does the same. A waiting download is
`queued` with `errorKind: "rate_limited"` and `retryAt`, and a waiting link stays `probing` with
the same two; the web says "The site is limiting requests. Trying again at 14:05." A rate limit
never fails anything, however long it lasts; a person can cancel a waiting download.

Each waiting download, and each waiting pasted link or search, gets one entry in its person's bell
("Waiting: <title>", `<site> is limiting requests. It will try again on its own.`), never pushed
(`src/downloads/waitNotices.ts`). It is told when the item starts waiting (its `error_kind`
becomes `rate_limited`), and tagged by the item (`rate-limit:download:<id>`,
`rate-limit:request:<id>`) and filed only if that tag isn't there, so the passes that wait out the
cooldown never file it again or mark it unread, even for someone who cleared their bell meanwhile;
a fetch several people wait on tells each of them. A download stored without its subtitles, which
the site limited (or whose cooldown was running), tells each of its people once too ("Subtitles
waiting: <title>", opening the video in their library; tag `rate-limit:subtitles:<id>`).
Subscription checks and hover previews hold nobody's item, so they tell no one.

Every limit a site answers with is also logged for the admin (`rate_limit_events`, kept a week):
the kind of work it held, yt-dlp's message, the video and the cooldown it set. Admin › Health shows
the log and the cooldowns ([health.md](health.md#rate-limits)).

**Subtitles** have a cooldown of their own (`subtitles`), since YouTube limits its caption files
apart from its videos. A fetch whose subtitles the site limits stores the video at once, without
them; while that cooldown lasts, fetches ask for none; and each such video gets a `subtitles` job
on the probe queue (key `subtitles:<media id>`, `src/worker/subtitlesJob.ts`) for just after the
cooldown, which fetches its subtitles alone (`downloadSubtitles`, yt-dlp's `--skip-download`),
signed in as the fetch's earliest waiter, and stores and indexes them as the fetch would have.
yt-dlp asks YouTube for subtitles while impersonating a browser, through curl_cffi, which the image
carries beside it (`scripts/image/requirements.txt`). Without it yt-dlp warns that no impersonate
target is available and asks as a plain client, which YouTube answered with a 429 every time.

## Large downloads

A download yt-dlp expects to be larger than `UROBOROS_LARGE_DOWNLOAD_BYTES` (30 GiB; 0 never asks)
waits for its owner's OK before it is fetched, however it started: a pasted link, entries ticked
in a preview, a subscription, MCP or a retry.

The size is yt-dlp's own, at the one moment it is known for every way in: a fetch's run prints it
(`--print before_dl:`, the `size` line in `@uroboros/ytdlp`'s progress protocol) once it has picked
the profile's formats and before it downloads a byte of them. It is `filesize` for one file and
otherwise `filesize_approx`, which for a merged pick (`bv+ba`) is the parts' sum. A link's probe
can't say it: it runs without the profile's `--format`, and a preview's or a subscription's
entries carry no formats at all. A video yt-dlp can't size (a live stream, some HLS) goes ahead.

When the size is over the limit and nobody waiting on the fetch has said yes, the run is stopped
there (as a cancel stops one: the process group killed, the partial files removed) and every
download waiting on it is **held** (`src/worker/sizeHold.ts`): back to `queued`, undispatched,
with `size_held_bytes` and `size_held_at`. The job ends without failing or spending an attempt,
each owner's freed slot goes to their next download, and each owner is told: a `downloads`
notice, "Large download needs your OK" ("Video is about 34.2 GB, over the 30 GB limit"), filed in
their list and pushed unless they turned download pushes off ([push.md](push.md#what-is-pushed)),
whatever a subscription's own switch says, since the download waits on them. Dispatch passes held
downloads by.

The Downloads page shows a held download as "Needs your OK" with the estimate, the limit (its
`sizeHold` in the contract), Download anyway and Cancel. Download anyway
(`POST /api/downloads/{id}/confirm`, MCP's `confirm_download`; 409 for a download not held) sets
`size_ok_at` and dispatches it, and a fetch with a confirmed download waiting on it is never held,
so everyone else waiting on that file gets it too. Retrying a held download that was cancelled
asks again, unless it was confirmed before. Raising the limit, or setting it to 0, lets go of the
holds it no longer makes: the leader's reconcile (`releaseHolds` in
`src/downloads/reconcile.ts`, at once when it starts and then every minute) dispatches them, and
their fetch asks yt-dlp the size anew.

## Cancel and retry

Cancelling marks that person's download `cancelled`. Only when no other active download waits on
the fetch key is the fetch stopped: a waiting job is removed, a running one gets a message on the
`uroboros_cancel` channel ([jobs.md](jobs.md)), and the replica running it aborts (yt-dlp's process
group is killed and its partial files removed). Retrying a failed or cancelled download queues it again from scratch.
Members act on their own downloads; admins on anyone's.

## Live progress

The replica running a fetch publishes progress and state changes on the `uroboros_downloads`
channel ([jobs.md](jobs.md)).

- **How often.** Progress goes out at most twice a second per fetch, plus at every phase change
  (downloading, merging, postprocessing, storing). Only one write is in flight at a time, and a
  newer value replaces any still waiting.
- **For page loads.** The latest progress is kept for a minute in the unlogged `download_progress`
  table, which the leader sweeps.
- **The stream.** Every replica's listener feeds `GET /api/downloads/events` (`src/downloads/sse.ts`),
  which streams `DownloadEvent`s for the caller's downloads (`?all=true`: everyone's, admins only),
  a `notice` event whenever the caller's notification list changes, a `previews` event whenever
  their hover previews being made change ([push.md](push.md#the-list-in-the-app)), and a `library`
  event when an upload of theirs is filed ([uploads.md](uploads.md)).
- **The library keeps up.** A download reaching `done`, or a `library` event, fetches the library's
  lists again (the grid, a channel's videos, the search palette, the channels), so a new video
  shows up where the person is looking without a reload. Only the lists on screen fetch at once,
  and one already fetching starts over, since its answer may predate the change.
- **One stream per browser.** The web app follows the caller's stream from the shell, for the bell
  and the Downloads page alike, and only in one tab: a browser allows about six HTTP/1.1
  connections to one origin, so the tab holding a Web Lock streams and passes every message to the
  others over a BroadcastChannel, and the next tab takes over when it closes
  (`apps/web/src/api/liveEvents.ts`). The admin's everyone view opens a stream of its own.
- **Dropped streams.** When the listener reconnects, every open stream ends, since events may have
  been lost meanwhile. The web app refetches whenever its stream drops, or another tab takes it
  over.
- **What is active.** `GET /api/downloads?active=true` lists only the queued and running downloads,
  which the bell starts from.

## Format profiles

yt-dlp presets (`format_profiles`, `src/downloads/profiles.ts`): a format selector, a container to
merge into and a preferred video codec, or audio-only with an audio format, and extra arguments from the wrapper's allowlist (each value checked against its flag's pattern, and the pacing ones
bounded: `--limit-rate` at least 100K, retries at most 50, sleeps at most 300 s, and no
`--throttled-rate`, whose re-extraction loop sleeps again on every pass. The floor still lets a
download of more than about 2 GB, or one from a slow server, run into the 6-hour fetch timeout,
holding one of its owner's slots until then; checked by the
server with `@uroboros/ytdlp/flags` when saved, and
again, with the server's own subtitle arguments, when the job runs; its one extractor argument is
`youtube:skip=translated_subs`, which those use, [library.md](library.md#subtitles-and-chapters)). `revision` hashes the file-shaping arguments, and renditions are keyed by
profile and revision, so editing a profile makes new downloads fetch a fresh file instead of
reusing one made with the old arguments; files already in libraries stay.

Settings › Profiles shows a profile as plain choices (`apps/web/src/settings/profileShape.ts`), and
writes the selector from them:

- **Quality**: best available (`bv*+ba/b`) or up to 4K, 1440p, 1080p, 720p, 480p or 360p
  (`bv*[height<=N]+ba/b[height<=N]`). A selector the form doesn't write stays under Advanced, in
  place of the quality, beside the extra arguments.
- **Video codec** (`video_codec`): any, AV1, VP9, H.265 or H.264, preferred among copies of the same
  resolution. The highest resolution still comes first, and a video without the codec gets the
  closest one yt-dlp ranks: the profile restates yt-dlp's own order with its codec in it,
  `--format-sort=lang,quality,res,fps,hdr:12,vcodec:<codec>,channels,acodec[:<audio>]`. YouTube
  offers AV1 and VP9 up to 4K and H.264 only up to 1080p, and no H.265 at all, so an uncapped H.264
  profile still gets VP9 at 4K there.
- **Container** (`merge_format`): any, MP4, MKV or WebM, the format the video and audio are merged
  into; a site that serves one ready-made file keeps its container. MP4 prefers AAC audio, which
  plays wherever MP4 does, and WebM Opus, the only one it holds besides Vorbis. WebM holds only AV1
  or VP9 video, so the server refuses H.264 or H.265 with it, and the form doesn't offer them.
- **Audio only**: the audio format (Opus, M4A, MP3, FLAC or WAV). The lossy ones take stereo first:
  yt-dlp ranks a format's channels above its codec, so a bare `ba/b` takes a 5.1 track where one
  is offered (YouTube's AAC 5.1), and converts it. Opus and M4A take the site's own when it has
  one, so nothing is converted (`ba[acodec=opus]/ba[audio_channels<=2]/ba/b`,
  `ba[ext=m4a][audio_channels<=2]/ba[ext=m4a]/ba/b`), and MP3 the best stereo
  (`ba[audio_channels<=2]/ba/b`). FLAC and WAV, which hold surround, take the best audio (`ba/b`).
  A profile saved with another selector keeps it, shown under Advanced.

- **Built-ins** (`user_id` null) are everyone's to start with. None of them marks or cuts
  SponsorBlock segments: what a person's player shows and skips is their own setting, Settings ›
  SponsorBlock ([automation.md](automation.md#sponsorblock)):
  - "Best available" (the default), "Best up to 1080p (MP4)" and "Up to 720p (MP4)", the smaller
    one for phones and tight storage, each AV1 in MP4 with AAC audio at the height its name says
    (AV1 is yt-dlp's own first choice; the MP4 makes the file play outside browsers too);
  - "Audio only (Opus)": the site's own Opus, kept as it is when there is one;
  - "Music (MP3)": VBR best (`--audio-quality=0`) with metadata and cover art embedded;
  - "Podcasts (M4A)": AAC with metadata and chapters embedded.

  The three audio ones write the form's selectors above, so they take stereo first, since 0.1.6
  (`20261128022852_audio_presets_stereo.sql`). Nobody edits a built-in in place, an admin included:
  an edit makes a person's own copy (below), which keeps the selector it had. So that migration's
  check of each row's seeded revision only spares a built-in changed by hand in SQL; its comment's
  "an admin has edited" means that.

  A person may change them, for themselves alone (`src/downloads/profileEdits.ts`): editing one
  makes it a profile of their own (copy-on-write: a new row, the built-in hidden from them in
  `hidden_profiles`, their subscriptions and default moved to the copy), and deleting one hides it
  from them. Everyone who keeps a built-in shares its fetches and files.

- **Personal profiles** belong to one person, who alone sees and uses them (Settings › Profiles);
  anyone else's, or a built-in someone hid, is 404 on the profile routes and 400 as a download's or
  subscription's profile. A name is unique among the profiles a person sees; two people may share
  one. A profile of one's own that downloads, subscriptions or library files use cannot be deleted,
  nor a built-in the person's subscriptions follow, nor anyone's last profile.
- **A default per person**: `PUT /api/format-profiles/default {profileId}` picks any profile they
  see (`user_default_profiles`); without one, the built-in default if they kept it, else their
  first. A download or request without a profile uses it, and `GET /api/format-profiles` marks it
  `isDefault` for the caller.

Fetches and files are shared by profile and revision, so people on a built-in share them; a
personal profile's files are its owner's. Deleting an account removes its profiles with its
downloads and subscriptions; its files keep no profile (`renditions.profile_id` is set null) and,
referenced by nobody, go to the reaper. On a filesystem, files are named by profile name: when
another file holds the path, `freeKey` adds the short revision, and then the profile's id too.

## Storage

`UROBOROS_STORAGE` picks the backend (`src/storage/`); both pass one contract test suite.

- **s3**: any S3-compatible service (RustFS locally and in tests, never MinIO), opaque keys:
  `media/<mediaId>/<profileId>-<revision>.<ext>`, `media/<mediaId>/thumbnail.jpg`,
  `media/<mediaId>/info.json`. The bucket must exist (compose's `rustfs-init` creates it).
- **filesystem**: organized folders on a volume the replicas share, from
  `UROBOROS_STORAGE_LAYOUT` (default
  `{channel}/{upload_date} {title} [{id}]/{title} [{profile}].{ext}`), with the thumbnail and
  `.info.json` beside the media file. Tokens: `channel`, `uploader`, `title`, `id`, `extractor`,
  `upload_date` (YYYY-MM-DD, or `unknown-date`), `year`, `profile`, `ext`. Every token value, and
  then every path segment, is sanitized: no separators or control characters, no leading dots, at
  most 100 bytes on a character boundary, never empty. When a segment would pass 100 bytes, the
  longest token values are cut, never the literal text, so `[{id}]`, `[{profile}]` and `.{ext}`
  survive a long title. `{id}` is cut last and from its start, since a generic link's id ends in
  the hash that keeps two same-named links apart. A custom layout must use `{id}`, `{profile}` and `{ext}`. A file name carries
  the profile's name, not its revision, so when an edited profile's file would land on another
  revision's path, the short revision is added before the extension; `renditions.storage_key` is
  unique. Writes go to a temp file and are renamed
  into place. The stored key is the relative path, so a new layout affects new files only.

`GET /api/library/{id}/file` streams the file with range support, named
`<title> [<profile>].<ext>`; with `UROBOROS_S3_PUBLIC_URL` set it redirects to a URL presigned
against that endpoint for 15 minutes instead. `GET /api/library/{id}/thumbnail` serves the
thumbnail. Removing a library entry deletes the row only; the reaper deletes a file once no entry
has referenced it for a day ([automation.md](automation.md#the-reaper)). Every stored file's size
is recorded beside its key, for Admin › Stats ([library.md](library.md#stats)).

Pasted links and new uploads dispatch before a subscription's backfill (`downloads.priority`), and
every YouTube download keeps its SponsorBlock segments for each person's player to show or skip by
their own setting ([automation.md](automation.md#sponsorblock)).

### Saving a file

Save is a plain download link to the file (`GET /api/library/{id}/file`, a copy's `GET
/api/exports/{id}/file`, a public link's file) everywhere but the installed iPhone or iPad app.
There, following a link to a file hands the app's only page to iOS's file view ("Open in…"), and
a home-screen app has no browser chrome to leave it by: the person must force-quit the app (WebKit
bug 290847; the `download` attribute doesn't stop it for a video). A window the app opens is no
way out either: iOS shows it as an in-app Safari sheet, which can't download a file and shows a
blank page. So in that app (`savesInWindow`, `apps/web/src/library/saveInWindow.ts`) Save hands
the file to Safari itself, through its `x-safari-https:` scheme (iOS 17 and later; undocumented,
so it may change), where Safari's downloader saves it to Files › Downloads and the app stays as it
was. An app still in front 1.5 s later (an older iOS) says it couldn't open Safari. iOS has no
`x-safari-http:`, so on an http address (a LAN install) Save stays the plain download link, and
iOS's file view takes the app over as before.

Safari doesn't have the app's cookies (iOS gives a home-screen app its own storage), so what it gets
is a **save link**, which needs none. `POST /api/library/{id}/save-link` (an entry the caller sees,
own or shared) and `POST /api/exports/{id}/save-link` (a finished copy of theirs) answer 201 with
`{ url, expiresAt }`, a URL under `/api/public/saves/{token}` that works for an hour, for any
number of requests (the downloader resumes with ranges). The app chooses the token itself (`{
token }`, 32 random bytes in base64url; 409 if it is taken), so it knows the link inside the tap
and hands it to Safari at once, registering it alongside with a request kept alive as Safari puts
the app away; a link Safari asks for before it is registered is waited for up to 1.5 s. Without a
body the server picks the token. Only the token's SHA-256 is stored (`save_links`); every use
checks access again as its person, so a share revoked since stops it, and serves exactly what the
file route would (ranges, or the presigned redirect). The leader's sweeper deletes expired links. A
public link's file needs no session, so it is handed to Safari as it is.

A clip ([sharing.md](sharing.md#clips)) saves from Copies to save like any copy, and a clip shared
on its own from `GET /api/clips/{id}/file` (or its link's `…/clip/file`). In the installed iPhone app
a clip shared with someone saves through a plain link: save links resolve a copy as its own
person's, so a recipient's Save hits iOS's file view, as on an http address.

## Scratch space

yt-dlp and ffmpeg need a real folder for a download's parts, their merge and any post-processing:
a bucket can't hold a file still being written. Every job that downloads or encodes (a fetch,
held-back subtitles, a hover preview, a copy without sponsors) works in a folder of its own run in
the work dir, `<label>.<12 hex>` (`src/worker/scratch.ts`), removed when the run ends, however it
ends.

`UROBOROS_WORK_DIR` names the work dir. Unset, it is `.uroboros-work` in the storage root with
filesystem storage: on the library's own disk, a finished file is renamed into place
(`MediaStore.move`) rather than copied, so it is written once, and scratch has the volume's room
rather than memory. With S3 it is `$TMPDIR/uroboros-work` (a tmpfs in compose), and the file is
uploaded to the bucket. A work dir on another disk than the library works too; its files are
copied.

The work dir may be shared by every replica and outlive a restart, so no two runs share a folder:
a run that lost its job to another ([jobs.md](jobs.md)) may still be writing in its own. An open
run touches its folder every 5 minutes, and every replica, as it starts and every 15 minutes,
removes the run folders untouched for an hour, which only a replica that died mid-job leaves.
Saved logins' `.netrc` and the cookie copies never go there; they stay in the process's own temp
folder.

## JavaScript challenges

YouTube serves some formats only after a JavaScript challenge. The image installs yt-dlp's
`[default]` extras, which include the yt-dlp-ejs solver scripts, and every probe and download runs
with `--js-runtimes node:<the server's own node>`, so the solver runs on the Node 24 already in the
image (no Deno needed).

## Site logins

People save a username and password for any site yt-dlp can sign in to, under Settings › Logins
(`/api/me/site-logins`, cookie sessions only: an API token is refused). The sites are the pinned
yt-dlp's netrc machine names, generated into `packages/contract/src/generated/loginSites.ts` by
`mise run gen:login-sites` (YouTube is left out: it takes cookies only); the image smoke test fails
while the committed list differs from the image's yt-dlp, so a yt-dlp bump regenerates it.

- **At rest:** one `site_logins` row per person and site. The password is sealed with AES-256-GCM
  (`src/secrets/seal.ts`; nonce, ciphertext and tag, with the owner and site as additional data)
  and never leaves the server. Without `UROBOROS_SECRETS_KEY` saving is off (409) and the jobs use
  no logins; a changed key leaves old rows unreadable, listed as such for their owner to enter
  again. There is no key rotation.
- **The key:** `UROBOROS_SECRETS_KEY` is any passphrase of 8 or more characters, stretched into the
  32-byte key with argon2id (19 MiB, 2 passes, a fixed salt; `src/secrets/key.ts`) once when a
  process starts. The stretching makes each guess slow, but a short passphrase is still only as
  safe as it is hard to guess for someone holding a copy of the database, so use
  `openssl rand -hex 32`. A value in the older form, 32 bytes of standard base64 (44 characters
  ending in `=`), is used as the key itself, so the logins saved under it keep opening.
- **Whose logins a run uses:** a probe signs in with the requester's logins (a channel's tab
  probes too), and a subscription's listing and full probes with its owner's (`withLoginsOf`,
  `src/worker/logins.ts`). A fetch is shared, so right before each attempt it takes, per site, the
  login of the earliest-waiting person on its fetch key who has one (`loginsForFetch`). Like a
  shared rendition, the file then serves everyone waiting.
- **How yt-dlp gets them:** the wrapper writes the run's logins to a private `.netrc` (mode 0600,
  in a fresh temporary directory removed afterwards) and passes `--netrc --netrc-location`, so
  each extractor looks up its own site and no password is on the command line. Values are quoted
  netrc tokens (no control characters allowed), and each saved password is scrubbed from the kept
  stderr lines.
- **A refused login** (`login_failed`: "bad username or password" and its kin) fails at once, with
  no retry.

## What a download can reach

yt-dlp fetches whatever http or https link a person pastes, follows its redirects, and does so
from the server's own network. Nothing holds it to public addresses, so anyone who can download
can make the server request an internal one: another container, a machine on the LAN, a cloud
provider's metadata address. What yt-dlp can read there as a video is downloaded and stored like
any other, and a failed request shows yt-dlp's error output, which says whether the host
answered. Uroboros treats the people it has accounts for as trusted to fetch from its network (a
NAS on the LAN is a fair source). An operator who doesn't trust them that far restricts what the
containers can reach at the network: a firewall rule, or an egress proxy. ffmpeg never reads
another file or URL into anything stored or played: its inputs are pinned to media containers (the
fetch, step 6). yt-dlp's own ffprobe calls take no arguments and still open what a fake playlist
names, but only to read it and throw the answer away, so they add blind requests and nothing more.

## Not yet

Per-user cookies. Subscriptions,
retention and the reaper are in [automation.md](automation.md).
