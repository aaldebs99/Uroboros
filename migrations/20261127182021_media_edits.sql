-- 20261127182021_media_edits.sql
-- Forward-only: never edit this file once it has been applied anywhere.

-- A person's own details of a video they hold (docs/library.md#your-own-details): shown in place of
-- its site's (or its uploader's) to them, and to whoever they share it with. Kept per person and
-- media, like `watch_progress`, so every entry of theirs on the video shows them, removing the video
-- and adding it back brings them back, and probes and fetches (which rewrite `media`) leave them
-- alone. A null field is the site's; a description of '' is one they cleared. The channel is the one
-- they moved the video to: its name, the extractor whose channels it joins, and that channel's id
-- when it joined one keyed by id (the name keys it otherwise). The release before never reads it.
CREATE TABLE media_edits (
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  media_id UUID NOT NULL REFERENCES media ON DELETE CASCADE,
  title TEXT CHECK (title <> ''),
  description TEXT,
  channel TEXT CHECK (channel <> ''),
  channel_extractor TEXT,
  channel_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, media_id),
  CHECK ((channel IS NULL) = (channel_extractor IS NULL)),
  CHECK (channel_id IS NULL OR channel IS NOT NULL),
  -- Nothing edited is no row.
  CHECK (num_nonnulls(title, description, channel) > 0)
);
-- For the cascade when a video's media row goes.
CREATE INDEX media_edits_media_idx ON media_edits (media_id);
