# Library

What each person can do with what they downloaded: search, browse, watch, and pick up where they
left off. Downloads and storage are in [downloads.md](downloads.md); playlists, sharing and
public links in [sharing.md](sharing.md).

## Search, filters and paging

`GET /api/library` answers a `LibraryPage` (`entries`, `nextCursor`), 60 entries at a time (or
`limit`, 1 to 60), always of the caller's own entries (`src/library/query.ts`):

- `q`: a search (see [Search](#search) below).
- `url`: a pasted http(s) link, answering the entries of the video it points at
  (`src/library/linkMatch.ts`). A YouTube link in any of its shapes (`watch?v=`, `youtu.be/`,
  `/shorts/`, `/live/`, `/embed/`, on `www.`, `m.` or `music.`) matches by video id; any other
  matches the stored page URL, as pasted or without its fragment, in either scheme, with or
  without `www.` and a final slash.
- `channel` (a channel key), `tag`, `watched` (`true`/`false`), `source` (a YouTube playlist the
  caller has) and `playlist` (one of the caller's manual playlists); another person's playlist is
  404, and `source` with `playlist` is 400.
- `inPlaylist`: `true` keeps only the videos in one of the caller's playlists, of either kind, and
  `false` only those in none (see [Hide playlist videos](#hide-playlist-videos)).
- `kind`: `video` keeps only the files with a picture and `audio` only those with sound alone (see
  [Videos and audio](#videos-and-audio)).
- `sort`: `added` (newest first; the default), `uploaded`, `title`, `duration`, `relevance` (best
  match, the default with `q`, and only with it) or `position` (playlist order; the default with
  `source` or `playlist`, and only with one). Another sort with `q` orders the matches.
- `cursor`: keyset paging on the sort key and the entry id, so entries added while someone pages
  never cause duplicates or gaps. A cursor this server didn't make is 400.

Each entry carries the caller's progress and tags, and the key of its channel page.

### Search

A search finds substrings, as Djinn's does: `ILIKE '%…%'` through `pg_trgm` trigram GIN indexes, so
part of a word finds it ("kube" finds Kubernetes), names, numbers and any language work, and nothing
is stemmed (`src/library/searchTerms.ts`, `src/library/search.ts`).

- **Terms.** `q` is trimmed and split at spaces into words; a `"quoted phrase"` stays one term (an
  unclosed quote runs to the end), and `OR` or `-word` are words like any other. Repeats are
  dropped, whatever their case, and `%`, `_` and `\` match themselves.
- **Rules.** 3 to 200 characters, at most 8 terms, and at least one term with 3 letters or digits in
  a row (what a trigram index can find); anything else is 400. Spaces alone are no search.
- **Matching.** Every term must appear within one place: a video's title, channel and description
  together (the channel is the uploader when there is none), one chapter title, or one run of
  caption lines (see [Subtitles and chapters](#subtitles-and-chapters)). A word in the title and
  another in a chapter don't match, nor do words in neighbouring runs.
- **Rank.** The best place a video matched (title, then channel, then a chapter, then the
  description, then the captions), then the newest entry; the cursor carries both.
- **Indexes.** `media_search_idx` is an expression index over `media_search_text(title, channel,
  uploader, description)` and `media_chapters_search_idx` one over `media_chapter_text(chapters)`
  where there are chapters, both immutable SQL functions in the schema, and
  `caption_segments_text_idx` is one over `caption_segments.text`; the query repeats each
  expression exactly, or the index goes unused, and a plan test (`searchPlan.test.ts`) checks
  EXPLAIN names all three. Edits to an upload's details re-index themselves.
- **Shape of the query.** The matches are found first, in materialised CTEs, and only then kept to
  the caller's own media (`(m.id IN (SELECT media_id FROM owned)) IS TRUE`, a hashed filter), so the
  planner never walks a whole library to filter it; the page then joins them as `h`.
- **Bound.** A search runs under `SET LOCAL statement_timeout = '10s'`; one cut short (a common word
  like "the" in a very large library) is 503 `unavailable`, asking for more specific words. At most
  4 searches run at once on a replica (each holds a pooled connection, and the pool also serves
  the job consumers); one more is 503 at once. The web never retries a search refused with 400 or
  503 (`retryLibrary`).

- **Where it matched.** With `q`, each entry carries `match` (`src/library/searchMatches.ts`): the
  best place it matched that the tile doesn't show already, the first chapter, else the
  description, else the first caption run holding every term, or null when only its title or
  channel did. So a title match whose captions hold the words too still shows them. A match is
  `in` (`chapter`, `description` or `captions`), a `snippet` of parts with every term marked
  (`src/library/snippet.ts`, ported from Djinn's: one line, 40 characters before the first match
  and 120 after, `…` where it was cut), and `start`, the chapter's start or the start of the
  caption line holding the match (`caption_segments.line_at`/`line_start`), null for a
  description. It is asked of the page's media alone, inside the search's bound, with every
  predicate wrapped (`(… ILIKE …) IS TRUE`) so the planner reads those media's rows rather than the
  trigram index's every match.

The web doesn't send fewer than 3 characters: the library page says "Type at least 3
characters.", and so does the palette. A tile shows its match as a muted line under its details
("Captions · 12:34 · …the words…", the terms highlighted; `apps/web/src/library/MatchLine.tsx`); a
chapter or caption match links to its moment, `/library/{id}?t=<seconds>`, while the thumbnail and
title still resume where the person left off. Palette rows show it too, and choosing a timed one
opens at its moment.

The web's **search palette** (Ctrl+K or ⌘K anywhere, or the phone's search button;
`apps/web/src/search/`) asks this route as the field is typed in: words with `q` and `limit=8`
(once typing rests for 200 ms, and from 3 characters), a pasted link with `url` and `limit=5`. Words also offer "Search
YouTube for …" ([downloads.md](downloads.md#flow)), whose results download from the palette one by
one; a link the library doesn't have offers "Download this link" (the default profile) or "Choose
a format…" (the Download a link dialog, with the link filled in).

## Videos and audio

Library › Videos and Library › Audio (`/library/audio`) split the library by what the file holds:
a file with a video stream is a video, and one with sound alone, such as a download with an
audio-only profile, is audio (`renditions.video_codec` null; a music file's cover art is not a
video stream, `src/transcode/facts.ts`). That is the same line `hasVideo` and the SponsorBlock
settings draw. Each view asks `GET /api/library` with its `kind`, and its watched, tag and sort
filters stay on that view, but a search (`q`) shows both kinds on either view, so the top bar's
"See all" finds everything. Channel and playlist pages, Up next and the search palette show both
kinds, and `kind` is the API's own filter, honoured with `q` too.

## Channels and playlists

A channel is the extractor plus the site's channel id, or the channel's name when the site gives no
id; its key is that, base64url-encoded (`src/library/channelKey.ts`). Videos with neither belong to
no channel: their `channel` is the site's name instead (`src/library/platform.ts`: YouTube, Vimeo
and other well-known sites by name, any other site, a direct link included, by its page's host),
with a null `channelKey`, so the web shows the site where the channel would be and links nowhere.
`GET /api/library/channels` lists the caller's channels, most entries first. An uploaded video's
channel is its creator, under the `upload` extractor ([uploads.md](uploads.md)).

Queueing a **playlist** from a preview, or following one with a subscription, records it
(`sources`, shared by extractor and id), that this person has it (`user_sources`), and its entries
in order (`source_items`, joined to media by extractor and video id, since an entry has no media
row until it is fetched). A YouTube playlist shows only to the people who have it; channel tabs are
not recorded. People also make playlists of their own; `GET /api/playlists` lists both kinds
([sharing.md](sharing.md)).

### Hide playlist videos

Library › Videos has a **Hide playlist videos** chip after All, Unwatched and Watched, and Library ›
Audio the same chip as **Hide playlist audio**: one setting for both views. It is off by
default, and it is kept on the person's account, so it follows them to every device:
`GET /api/me/preferences` answers their `Preferences` (`user_preferences`, no row meaning the
defaults), and `PATCH` changes only the fields it names. While it is on, the page asks for
`inPlaylist=false`, its searches and tag filters too, and an empty page says "Nothing outside your
playlists." with a way to Playlists. A video counts as a playlist video when it is in one of the
person's own playlists (`playlist_items`) or in a YouTube playlist they have (`user_sources` with
`source_items`, by extractor and video id); another person's playlist never hides it. Channel and
playlist pages, the search palette and API callers that don't ask for `inPlaylist` are unaffected.

### SponsorBlock

Settings › SponsorBlock keeps the person's SponsorBlock choices in the same `Preferences`
(`sponsorBlock`): for videos and for audio files apart, which categories their player shows as
bands and which it skips. Each switch patches `sponsorBlock` alone and fetches open items again,
since the server resolves an item's segments by it ([automation.md](automation.md#sponsorblock)).
Under the switches, a color picker per category and one for the highlight
(`sponsorBlockColors`, SponsorBlock's own until changed) saves once the picking stops; the player
reads the colors straight from the preferences, so nothing is fetched again.

## The item page

`GET /api/library/{id}` gives an entry with its description, chapters, subtitles, playlists (its
YouTube ones as `sources`, the person's own as `playlists`) and stream URL, for the caller's own
entry or one shared with them (`sharedBy` names its owner then; [sharing.md](sharing.md)). `GET /api/library/{id}/stream` serves the file inline with range support (or redirects
to a presigned URL when `UROBOROS_S3_PUBLIC_URL` is set; the CSP's `media-src` allows that origin),
and `GET /api/library/{id}/subtitles/{subId}` serves a WebVTT file. The web app plays it with
Video.js 10 (`@videojs/react`, the Neutral video skin in the app's accent): subtitles are `<track>`s
in its captions menu, chapters are a text track its time slider divides into sections, and the page
also lists the chapters to jump to (`apps/web/src/library/Player.tsx`). An audio file (no video
stream, as Library › Audio counts it) shows its thumbnail where the picture would be, whole over a
blurred copy of itself, or a music glyph when it has none; it lies behind the media element, so
the controls and captions draw over it (`AudioArtwork.tsx`). The item's
`sponsorSegments`, the file's SponsorBlock segments as the caller's setting has them, are bands on
the timeline (strong where playback jumps them, faint where it only shows them), and playback jumps
over a skipped one when it runs into it, without a toast; a segment the viewer seeks into plays out
(`SponsorSkip.tsx`, [automation.md](automation.md#sponsorblock)), each category in the viewer's
color. The file's SponsorBlock highlight (`sponsorHighlight`) is a mark on the timeline, and a
Jump to highlight pill in the player's corner goes there while playback is short of it
(`HighlightJump.tsx`). The owner can fetch a file's
segments again from the page (Refetch SponsorBlock segments,
[automation.md](automation.md#sponsorblock)). When the browser cannot play
the file (MKV, or a codec it lacks), it plays a compatible HLS copy made on demand instead
([transcoding.md](transcoding.md)). The page starts where the person left off, or at `?t=<seconds>`
(a search match's moment) when the address has it; the next video of a queue never carries it.
Above the player, a back link names the page the video was opened from and returns to it as the
browser's Back would, past the videos played since, so its search and filters are as they were; a
page opened from outside the app (a link, a notification) leads to the Library
(`WatchBack.tsx`, `watchOrigin.ts`).

Every entry says where it came from (`origin`: `download`, or `upload` for a video someone uploaded)
and its format profile's name (`profileName`, null for an upload, or once a download's profile went
with its owner's account; the queries left-join the profile). Thumbnail URLs end in `?v=` and a hash
of the thumbnail's storage key, so a replaced thumbnail shows at once although browsers cache them
for a day. An item the caller uploaded is `editable`: its title, description, creator and thumbnail
can be changed ([uploads.md](uploads.md#editing)).

## Watch progress

Progress is per person and media (two profiles of one video share it). The player reports the
position at most every 10 s and on pause and at the end (`PUT /api/library/{id}/progress`); the
position is clamped to the duration, and the video counts as watched once past 90%, which a later
report from earlier in it (a rewatch, a late report) doesn't undo. `PUT /api/library/{id}/watched`
sets it by hand; unwatching also starts it over. Tiles show a watched bar; the item page resumes
where the person left off.

## Hover previews

A video's tile plays the whole video, smaller, while it is hovered with a mouse (after 300 ms), or
after a press and hold of 400 ms on a touch screen. It starts at the beginning, muted, with captions
on, and has its own controls: a scrub bar along the bottom, a sound button in the top right and a
captions button below it. What it plays is, best first:

1. **The stored preview**, which the server makes once per media: the whole video at 480p with its
   sound, so it starts at once, plays the same for every file the library holds and seeks anywhere.
2. **The original**, when there is no stored preview yet (or it failed to play) and this browser
   plays the file itself (`canPlayOriginal`): no server work, but the file's own size.
3. **A live 480p playback session** ([transcoding.md](transcoding.md)) otherwise, asked for when the
   preview starts and stopped the moment it does. It holds a transcoder slot meanwhile.

A source that fails to play gives way to the next.

- **The stored preview** (`packages/ytdlp/src/previewArgs.ts`) is H.264 at 480p (the short side,
  never scaled up), capped at 1 Mbit/s, with stereo AAC at 96 kbit/s, in an MP4 with `+faststart`;
  HDR is tone-mapped to BT.709. It is about half a gigabyte for an hour of video.
- **Where it comes from** (`UROBOROS_PREVIEW_METHOD`). With `download`, the default, the job
  downloads the video from its site again at 480p (`src/worker/previewDownload.ts`): yt-dlp's best
  video with the best sound, sorted by `res:480` (the largest whose short side is at most 480, else
  the smallest above it), H.264 and AAC first, signed in with the saved logins of the person who has
  had the video longest. A copy that already is a preview (H.264 in 8-bit 4:2:0, 480p at most, not
  HDR, at most 2 Mbit/s, with AAC or no sound, as YouTube's 480p is) goes into the preview's MP4 as
  it is, encoding nothing; any other is encoded from that copy. Its download waits out the site's
  rate limits as a fetch does ([downloads.md](downloads.md#rate-limits)), and a limit never fails
  it. The stored file is encoded instead for an upload, a media with no page, a file cut from the
  video (its profile has `--download-sections`, `--remove-chapters` or `--sponsorblock-remove`, so
  the preview shows what the library holds) and a video the site no longer gives (gone, private,
  blocked); with `transcode`, for every video.
- **The job** (`preview` queue, `src/worker/previewRun.ts`) runs on replicas that run sessions, one
  at a time, encoding on the CPU with the transcoder's ffmpeg; from the stored file, it reads the
  media's smallest stored video of at least 480p (else its tallest). It stores the preview at
  `.previews/<media id>.mp4` (`media.preview_key`). Two attempts; one that fails for good sets
  `media.preview_failed_at`.
- **What queues it:** a download that stored a video, a filed upload, and the leader's backfill
  (`src/previews/sweep.ts`), which every minute queues up to 30 media with a stored video, no
  preview, none failed and none waiting, so a library made before previews gets them at the
  encoder's pace (a long video takes minutes). Audio has none.
- **Serving.** `previewUrl` on a `LibraryEntry` (and on a video in Shared › With me) is
  `GET /api/library/{id}/preview`, which answers to whoever sees the entry and serves byte ranges,
  cached for a day; null until the preview is made. `hasVideo` says whether the entry has a picture
  at all: a tile offers a preview only then, before the stored one exists too. The tile fetches
  the video's details (`GET /api/library/{id}`) as its preview starts, for the sources and the
  subtitles; the watch page reuses them.
- **Off.** `UROBOROS_GENERATE_PREVIEWS=false` makes none, new or backfilled, whatever
  `UROBOROS_PREVIEW_METHOD` says: a preview queued before it was turned off downloads and encodes
  nothing. Previews already made still play, and the others play the original or a live session.
  The reaper deletes a preview with its media.
- **The bell** lists the person's previews being made, one row however many, while any of their
  videos still wait for one, and none while previews are stalled ([push.md](push.md)).

**Sound.** Unmuting a preview carries over to the next ones in the tab until the page reloads; it
is never stored, and never the player's remembered volume. A browser that refuses to start with
sound gets the preview muted instead.

**Captions** show the remembered subtitle language (as the player picks it), else the first manual
track, else the first; the captions button hides and shows them for that preview only, and never
changes the player's remembered choice. Here and in the player, captions are centred
(`library/captions.ts`): YouTube's pin every cue to the left (`align:start position:0%`), and
their line stays as the file has it.

**Seeking.** The scrub bar is a band along the tile's bottom with the bar raised inside it, so a
pointer a little low still counts; a press seeks there, and a drag follows the pointer, even past
the tile's edge, without opening the video.

The preview is never the player: it reports no watch progress, however far it plays or seeks.
While it plays, the scrub bar takes the watched bar's place. Grid tiles have it (the library,
search, channels, playlists, a shared playlist and Shared › With me); the rows beside the player
(where a hover means picking), the playlist editor, the search palette and public links don't.

## Keep and retention

An entry a subscription brought carries it (`subscription`), and that subscription's retention may
remove it; **Keep** (`PUT /api/library/{id}/kept`), being in one of the person's playlists, or
being shared on its own exempts it ([automation.md](automation.md)).
Removing an entry, by hand or by retention, deletes the row; the reaper frees the file a day after
its last entry goes.

## Tags

Per entry and person: lower-cased, trimmed, 1–32 characters, at most 20 (`PUT
/api/library/{id}/tags` replaces them). The library filters by tag.

## Subtitles and chapters

Every download saves subtitles: `--write-subs --sub-langs <UROBOROS_SUBTITLE_LANGS>
--convert-subs vtt` (default `en.*`; empty saves none), plus automatic captions (YouTube's
transcripts) unless `UROBOROS_AUTO_SUBTITLES=false`. Each automatic caption is asked for once:
`,-.*-orig` joins the languages (YouTube's `en-orig` is the same file as its `en`) unless they
name an original themselves, and `--extractor-args youtube:skip=translated_subs` skips machine
translations of a video's subtitles (`en-de`), since every caption file is one more request to a
site that rate-limits them. A non-English video's English automatic captions are still a machine
translation of its speech. yt-dlp fetches subtitles before the media and fails the whole run when
one cannot be had (an HTTP 429 on YouTube's captions, say), so a fetch that fails that way runs once
more without the subtitle arguments (`withSubtitleFallback`, `src/worker/subtitles.ts`): the video
arrives, with whatever subtitles the first run finished. When the site rate-limited them, they
come later, once its cooldown is over ([downloads.md](downloads.md#rate-limits)). Each `.vtt` is stored beside the file (`media/<id>/subs/<lang>.vtt`
on S3; in the folder layout, beside the media file and named after it, `<file>.<lang>.vtt`, so
videos that share a title never share a subtitle; one that cannot be stored is skipped) and recorded in `subtitles`. Chapters come from
the `.info.json` into `media.chapters`.

**Captions for search.** Search reads the captions into `caption_segments` (`src/library/vtt.ts`,
`src/library/captionIndex.ts`) as each download stores them, from the files yt-dlp just wrote:

- **Parsing.** WebVTT cues lose their tags, inline timestamps and entities; YouTube's rolling auto
  captions (each cue repeats the last line, and 10 ms cues repeat everything) are read once each,
  a repeated line stretching the one already read; lines that are only a sound tag (`[Music]`) or
  notes are dropped. Only the first 4096 characters of a payload line are read, and every pattern
  runs in linear time, so a hostile file cannot stall the replica parsing it. Lines join into runs of at most 240 characters and 30 seconds, a silence of 5
  seconds starting a new one, and each run keeps where and when every line begins, so a match can
  play from its own line. A line over 400 characters is cut between words.
- **Which tracks.** One per language (the code before any `-`): manual over automatic, then the
  original (`en-orig`), then the plain code (`en` over `en-de` or `en-US`); at most 3 languages a
  video, those with a manual track first, and 5000 runs and 16 MiB of a track.
- **Failures.** Reading a media's captions is one transaction under `lockKey("CAPS", mediaId)`,
  which replaces its runs and marks its tracks read (`subtitles.indexed_at`). A file that cannot be
  read counts against its track (`index_failures`) and changes nothing else; the video's download
  succeeds all the same. The leader's catch-up duty reads, every minute, the captions of up to 50
  media with a track still waiting (at most 20 seconds a pass); a track that failed 3 times is
  given up, and the media's others are read without it.
- **Reading them again** (after a parser change, say): `UPDATE subtitles SET indexed_at = NULL`,
  and the duty reads every track again, 50 media a minute.
- Deleting a media deletes its subtitles and their runs (`ON DELETE CASCADE`).
