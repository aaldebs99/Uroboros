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
  like "the" in a very large library) is 503 `unavailable`, asking for more specific words.

The web doesn't send fewer than 3 characters: the library page says "Type at least 3
characters.", and so does the palette.

The web's **search palette** (Ctrl+K or ⌘K anywhere, or the phone's search button;
`apps/web/src/search/`) asks this route as the field is typed in: words with `q` and `limit=8`
(once typing rests for 200 ms, and from 3 characters), a pasted link with `url` and `limit=5`. Words also offer "Search
YouTube for …" ([downloads.md](downloads.md#flow)), whose results download from the palette one by
one; a link the library doesn't have offers "Download this link" (the default profile) or "Choose
a format…" (the Download a link dialog, with the link filled in).

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

## The item page

`GET /api/library/{id}` gives an entry with its description, chapters, subtitles, playlists (its
YouTube ones as `sources`, the person's own as `playlists`) and stream URL, for the caller's own
entry or one shared with them (`sharedBy` names its owner then; [sharing.md](sharing.md)). `GET /api/library/{id}/stream` serves the file inline with range support (or redirects
to a presigned URL when `UROBOROS_S3_PUBLIC_URL` is set; the CSP's `media-src` allows that origin),
and `GET /api/library/{id}/subtitles/{subId}` serves a WebVTT file. The web app plays it with
Video.js 10 (`@videojs/react`, the Neutral video skin in the app's accent): subtitles are `<track>`s
in its captions menu, chapters are a text track its time slider divides into sections, and the page
also lists the chapters to jump to (`apps/web/src/library/Player.tsx`). The item's `skipSegments`,
the SponsorBlock segments a video keeps, are bands on the timeline that playback jumps over when it
runs into one; a segment the viewer seeks into plays out (`SponsorSkip.tsx`,
[automation.md](automation.md#sponsorblock)). When the browser cannot play
the file (MKV, or a codec it lacks), it plays a compatible HLS copy made on demand instead
([transcoding.md](transcoding.md)).

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

A video's tile plays a short preview while it is hovered with a mouse (after 300 ms), or after a
press and hold of 400 ms on a touch screen: two seconds at the start, at 20%, 40%, 60% and 80%, or
the whole of a video under 15 seconds. It is a clip the server makes once per media, so it starts
at once, plays the same for every file the library holds, and costs a few hundred KB to watch:

- **The clip** (`packages/ytdlp/src/previewArgs.ts`) is silent H.264 at 480p (the short side, never
  scaled up), capped at 1 Mbit/s, in an MP4 with `+faststart`. Each snippet is its own input seeked
  before it is opened, so only a little around each point is read and decoded; HDR is tone-mapped
  to BT.709.
- **The job** (`preview` queue, `src/worker/previewRun.ts`) reads the media's smallest stored video
  of at least 480p (else its tallest), runs on replicas that run sessions, one at a time, on the
  CPU with the transcoder's ffmpeg, and stores the clip at `.previews/<media id>.mp4`
  (`media.preview_key`). Two attempts; one that fails for good sets `media.preview_failed_at`.
- **What queues it:** a download that stored a video, a filed upload, and the leader's backfill
  (`src/previews/sweep.ts`), which every minute queues up to 30 media with a stored video, no
  preview, none failed and none waiting, so a library made before previews gets them at the
  encoder's pace. Audio has none.
- **Serving.** `previewUrl` on a `LibraryEntry` (and on a video in Shared › With me) is
  `GET /api/library/{id}/preview`, which answers to whoever sees the entry and serves byte ranges,
  cached for a day; null until the clip is made.
- **Off.** `UROBOROS_GENERATE_PREVIEWS=false` makes none, new or backfilled; clips already made
  still play. The reaper deletes a clip with its media.
- **The bell** lists the person's previews being made ([push.md](push.md)).

The preview is a plain muted `<video>` laid over the thumbnail, not the player: it reports no watch
progress and never touches the remembered volume. Grid tiles have it (the library, search,
channels, playlists, a shared playlist and Shared › With me); the small rows beside the player, the
playlist editor, the search palette and public links don't.

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
translation of its speech. Each `.vtt` is stored beside the file (`media/<id>/subs/<lang>.vtt`
on S3; in the folder layout, beside the media file and named after it, `<file>.<lang>.vtt`, so
videos that share a title never share a subtitle; one that cannot be stored is skipped) and recorded in `subtitles`. Chapters come from
the `.info.json` into `media.chapters`.

**Captions for search.** Search reads the captions into `caption_segments` (`src/library/vtt.ts`,
`src/library/captionIndex.ts`) as each download stores them, from the files yt-dlp just wrote:

- **Parsing.** WebVTT cues lose their tags, inline timestamps and entities; YouTube's rolling auto
  captions (each cue repeats the last line, and 10 ms cues repeat everything) are read once each,
  a repeated line stretching the one already read; lines that are only a sound tag (`[Music]`) or
  notes are dropped. Lines join into runs of at most 240 characters and 30 seconds, a silence of 5
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
