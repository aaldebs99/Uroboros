# Library

What each person can do with what they downloaded: search, browse, watch, and pick up where they
left off. Downloads and storage are in [downloads.md](downloads.md); playlists, sharing and
public links in [sharing.md](sharing.md).

## Search, filters and paging

`GET /api/library` answers a `LibraryPage` (`entries`, `nextCursor`), 60 entries at a time (or
`limit`, 1 to 60), always of the caller's own entries (`src/library/query.ts`):

- `q`: full-text search over title, channel and description. `media.search` is a generated
  `tsvector` with the `simple` configuration (no stemming, any language) and a GIN index, queried
  with `websearch_to_tsquery`, so quotes, `OR` and `-word` work and odd input never errors.
- `url`: a pasted http(s) link, answering the entries of the video it points at
  (`src/library/linkMatch.ts`). A YouTube link in any of its shapes (`watch?v=`, `youtu.be/`,
  `/shorts/`, `/live/`, `/embed/`, on `www.`, `m.` or `music.`) matches by video id; any other
  matches the stored page URL, as pasted or without its fragment, in either scheme, with or
  without `www.` and a final slash.
- `channel` (a channel key), `tag`, `watched` (`true`/`false`), `source` (a YouTube playlist the
  caller has) and `playlist` (one of the caller's manual playlists); another person's playlist is
  404, and `source` with `playlist` is 400.
- `sort`: `added` (newest first; the default), `uploaded`, `title`, `duration`, `relevance` (the
  default with `q`) or `position` (playlist order; the default with `source` or `playlist`, and
  only with one).
- `cursor`: keyset paging on the sort key and the entry id, so entries added while someone pages
  never cause duplicates or gaps. A cursor this server didn't make is 400.

Each entry carries the caller's progress and tags, and the key of its channel page.

The web's **search palette** (Ctrl+K or ⌘K anywhere, or the phone's search button;
`apps/web/src/search/`) asks this route as the field is typed in: words with `q` and `limit=8`
(once typing rests for 200 ms), a pasted link with `url` and `limit=5`. Words also offer "Search
YouTube for …" ([downloads.md](downloads.md#flow)), whose results download from the palette one by
one; a link the library doesn't have offers "Download this link" (the default profile) or "Choose
a format…" (the Download a link dialog, with the link filled in).

## Channels and playlists

A channel is the extractor plus the site's channel id, or the channel's name when the site gives no
id; its key is that, base64url-encoded (`src/library/channelKey.ts`). Videos with neither belong to
no channel: their `channel` is the site's name instead (`src/library/platform.ts`: YouTube, Vimeo
and other well-known sites by name, any other site, a direct link included, by its page's host),
with a null `channelKey`, so the web shows the site where the channel would be and links nowhere.
`GET /api/library/channels` lists the caller's channels, most entries first.

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
also lists the chapters to jump to (`apps/web/src/library/Player.tsx`). When the browser cannot play
the file (MKV, or a codec it lacks), it plays a compatible HLS copy made on demand instead
([transcoding.md](transcoding.md)).

## Watch progress

Progress is per person and media (two profiles of one video share it). The player reports the
position at most every 10 s and on pause and at the end (`PUT /api/library/{id}/progress`); the
position is clamped to the duration, and the video counts as watched once past 90%, which a later
report from earlier in it (a rewatch, a late report) doesn't undo. `PUT /api/library/{id}/watched`
sets it by hand; unwatching also starts it over. Tiles show a watched bar; the item page resumes
where the person left off.

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
--convert-subs vtt` (default `en.*`; empty saves none), plus automatic captions with
`UROBOROS_AUTO_SUBTITLES=true`. Each `.vtt` is stored beside the file (`media/<id>/subs/<lang>.vtt`
on S3; in the folder layout, beside the media file and named after it, `<file>.<lang>.vtt`, so
videos that share a title never share a subtitle; one that cannot be stored is skipped) and recorded in `subtitles`. Chapters come from
the `.info.json` into `media.chapters`. Media downloaded before this step has neither.
