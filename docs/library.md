# Library

What each person can do with what they downloaded: search, browse, watch, and pick up where they
left off. Downloads and storage are in [downloads.md](downloads.md).

## Search, filters and paging

`GET /api/library` answers a `LibraryPage` (`entries`, `nextCursor`), 60 entries at a time,
always of the caller's own entries (`src/library/query.ts`):

- `q`: full-text search over title, channel and description. `media.search` is a generated
  `tsvector` with the `simple` configuration (no stemming, any language) and a GIN index, queried
  with `websearch_to_tsquery`, so quotes, `OR` and `-word` work and odd input never errors.
- `channel` (a channel key), `tag`, `watched` (`true`/`false`) and `source` (a playlist id, which
  must be one the caller queued; otherwise 404).
- `sort`: `added` (newest first; the default), `uploaded`, `title`, `duration`, `relevance` (the
  default with `q`) or `position` (playlist order; the default with `source`, and only with it).
- `cursor`: keyset paging on the sort key and the entry id, so entries added while someone pages
  never cause duplicates or gaps. A cursor this server didn't make is 400.

Each entry carries the caller's progress and tags, and the key of its channel page.

## Channels and playlists

A channel is the extractor plus the site's channel id, or the channel's name when the site gives no
id; its key is that, base64url-encoded (`src/library/channelKey.ts`). Videos with neither belong to
no channel. `GET /api/library/channels` lists the caller's channels, most entries first.

Queueing a **playlist** from a preview records it (`sources`, shared by extractor and id), that this
person queued it (`user_sources`), and its entries in order (`source_items`, joined to media by
extractor and video id, since an entry has no media row until it is fetched). A playlist shows only
to the people who queued it; channel tabs are not recorded. `GET /api/library/sources` lists the
caller's playlists that hold at least one of their entries.

## The item page

`GET /api/library/{id}` gives an entry with its description, chapters, subtitles, playlists and
stream URL. `GET /api/library/{id}/stream` serves the file inline with range support (or redirects
to a presigned URL when `UROBOROS_S3_PUBLIC_URL` is set; the CSP's `media-src` allows that origin),
and `GET /api/library/{id}/subtitles/{subId}` serves a WebVTT file. The web app plays it with
Video.js 10 (`@videojs/react`, the Neutral video skin in the app's accent): subtitles are `<track>`s
in its captions menu, chapters are a text track its time slider divides into sections, and the page
also lists the chapters to jump to (`apps/web/src/library/Player.tsx`).

## Watch progress

Progress is per person and media (two profiles of one video share it). The player reports the
position at most every 10 s and on pause and at the end (`PUT /api/library/{id}/progress`); the
position is clamped to the duration, and the video counts as watched once past 90%, which a later
report from earlier in it (a rewatch, a late report) doesn't undo. `PUT /api/library/{id}/watched`
sets it by hand; unwatching also starts it over. Tiles show a watched bar; the item page resumes
where the person left off.

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
