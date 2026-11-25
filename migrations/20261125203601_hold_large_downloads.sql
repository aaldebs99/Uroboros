-- 20261125203601_hold_large_downloads.sql
-- Forward-only: never edit this file once it has been applied anywhere.

-- Large downloads wait for their owner's OK (docs/downloads.md "Large downloads"). When yt-dlp has
-- picked a fetch's formats and says they are larger than UROBOROS_LARGE_DOWNLOAD_BYTES, and nobody
-- waiting on that fetch has said yes, the fetch stops before downloading them and every download
-- waiting on it goes back to queued, undispatched, held: size_held_bytes is yt-dlp's estimate and
-- size_held_at when. Dispatch skips a held download until its owner confirms it, which sets
-- size_ok_at and clears the hold, so the next fetch goes ahead. The release before knows none of
-- this and may dispatch a held download meanwhile; the fetch, run by this release, holds it again.
ALTER TABLE downloads
  ADD COLUMN size_held_bytes BIGINT CHECK (size_held_bytes >= 0),
  ADD COLUMN size_held_at TIMESTAMPTZ,
  ADD COLUMN size_ok_at TIMESTAMPTZ,
  ADD CONSTRAINT downloads_size_hold_check CHECK ((size_held_at IS NULL) = (size_held_bytes IS NULL));
