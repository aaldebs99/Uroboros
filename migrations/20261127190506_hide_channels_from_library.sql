-- 20261127190506_hide_channels_from_library.sql
-- Forward-only: never edit this file once it has been applied anywhere.


-- Hidden channels (docs/library.md#hiding-from-the-library): a person can keep a channel's videos
-- out of Library › Videos and Audio, for themselves alone, as a playlist can. A channel has no row
-- of its own; it is keyed as its route key is (src/library/channelKey.ts): the extractor, then the
-- site's channel id ('id') or, when the site gives none, the channel's name ('name'). The release
-- before never reads it.
CREATE TABLE hidden_channels (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  extractor TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('id', 'name')),
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, extractor, kind, value)
);
