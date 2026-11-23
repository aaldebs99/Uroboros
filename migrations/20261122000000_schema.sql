-- 20261122000000_schema.sql
-- The whole schema, squashed. Uroboros has no deployed databases yet, so until the first release
-- this one file is edited in place instead of adding migrations; after changing it, reset local
-- databases (docs: CLAUDE.md "Database and tests"). Once a release ships, it becomes forward-only
-- like any migration and changes go into new files.

-- Users and SSO (docs/auth.md). An account is local (username + argon2id password hash) or SSO
-- (OIDC issuer + subject), never both, so "reset password" and "role from IdP groups" are
-- unambiguous. A disabled row may have neither: the legacy placeholder below.
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT CHECK (username = lower(btrim(username)) AND username ~ '^[a-z0-9._-]{1,64}$'),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 128),
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  password_hash TEXT,
  oidc_issuer TEXT,
  oidc_subject TEXT,
  groups JSONB NOT NULL DEFAULT '[]',
  bootstrap BOOLEAN NOT NULL DEFAULT false,
  disabled_at TIMESTAMPTZ,
  -- Set by the claims sync when the provider refuses the user's refresh token; cleared by the
  -- next real sign-in.
  revoked_at TIMESTAMPTZ,
  claims_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT users_one_login_method CHECK (
    (username IS NOT NULL AND password_hash IS NOT NULL
      AND oidc_issuer IS NULL AND oidc_subject IS NULL)
    OR (oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL
      AND username IS NULL AND password_hash IS NULL)
    OR (disabled_at IS NOT NULL
      AND username IS NULL AND password_hash IS NULL
      AND oidc_issuer IS NULL AND oidc_subject IS NULL)
  )
);

CREATE UNIQUE INDEX users_username_key ON users (username) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX users_oidc_key ON users (oidc_issuer, oidc_subject) WHERE oidc_subject IS NOT NULL;
CREATE UNIQUE INDEX users_one_bootstrap ON users (bootstrap) WHERE bootstrap;

-- A signed-in browser. The cookie holds a random 32-byte token; only its SHA-256 is stored.
CREATE TABLE auth_sessions (
  token_hash BYTEA PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at);

-- An OIDC sign-in between the redirect to the provider and its callback (10 minutes).
CREATE TABLE auth_logins (
  state_hash BYTEA PRIMARY KEY,
  binding_hash BYTEA NOT NULL,
  nonce TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_logins_expiry_idx ON auth_logins (expires_at);

-- An SSO user's refresh token, redeemed by the claims sync. Plaintext like Djinn's: it is useless
-- without the client secret, which lives outside the database.
CREATE TABLE oidc_grants (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Personal API tokens (64 hex characters; only the SHA-256 is stored).
CREATE TABLE api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  token_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (user_id, name)
);

-- A push endpoint the user turned off from another device: launch-time sync must not quietly
-- re-register it. Keyed by the SHA-256 of the endpoint URL.
CREATE TABLE push_device_tombstones (
  endpoint_hash BYTEA PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Web Push (docs/push.md). A device is one browser's push subscription, owned by a user.
CREATE TABLE push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The push service URL is the subscription's identity: a browser that subscribes again on the
  -- same endpoint updates its row instead of adding one.
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ
);

CREATE INDEX push_devices_user_id_idx ON push_devices (user_id, created_at);

-- The deployment's VAPID key pair when none is configured. One row (id = 1): the first replica
-- to need it inserts a fresh pair with ON CONFLICT DO NOTHING and every replica reads back the
-- winner, so all of them sign with the same key.
CREATE TABLE vapid_keys (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Downloads and storage (docs/downloads.md). A format profile is an admin-defined yt-dlp preset;
-- `revision` hashes the arguments that shape the file, so editing a profile makes new downloads
-- fetch a fresh rendition instead of reusing one made with the old arguments.
CREATE TABLE format_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(btrim(name)) BETWEEN 1 AND 64),
  format TEXT NOT NULL CHECK (char_length(format) BETWEEN 1 AND 512),
  merge_format TEXT,
  audio_only BOOLEAN NOT NULL DEFAULT false,
  audio_format TEXT,
  extra_args TEXT[] NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  revision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (audio_only = (audio_format IS NOT NULL))
);
CREATE UNIQUE INDEX format_profiles_one_default ON format_profiles ((true)) WHERE is_default;

-- Revisions are profileRevision() of each row's arguments (apps/server/src/downloads/profiles.ts;
-- its test pins these literals).
INSERT INTO format_profiles (name, format, merge_format, audio_only, audio_format, is_default, revision)
VALUES
  ('Best up to 1080p (MP4)',
   'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]',
   'mp4', false, NULL, true, '88438c868e27'),
  ('Best available', 'bv*+ba/b', NULL, false, NULL, false, '9dbd9d2454da'),
  ('Audio only (Opus)', 'ba/b', NULL, true, 'opus', false, '52c4824db249');

-- One row per extractor and video id, shared by every user.
CREATE TABLE media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extractor TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT,
  channel TEXT,
  channel_id TEXT,
  uploader TEXT,
  upload_date TEXT,
  duration DOUBLE PRECISION,
  description TEXT,
  webpage_url TEXT,
  thumbnail_key TEXT,
  info_key TEXT,
  -- [{start, end, title}] from the .info.json.
  chapters JSONB NOT NULL DEFAULT '[]',
  -- Full-text search over title, channel and description; 'simple' so any language works.
  search TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(channel, '') || ' ' || coalesce(description, ''))
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (extractor, video_id)
);

-- One stored file per media, profile and profile revision.
CREATE TABLE renditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES media ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES format_profiles ON DELETE RESTRICT,
  profile_revision TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  container TEXT,
  video_codec TEXT,
  audio_codec TEXT,
  width INTEGER,
  height INTEGER,
  duration DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (media_id, profile_id, profile_revision),
  -- Two renditions never share a file.
  UNIQUE (storage_key)
);

-- A user's library: entries pointing at shared renditions. Removing one deletes the row only.
CREATE TABLE library_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  media_id UUID NOT NULL REFERENCES media ON DELETE CASCADE,
  rendition_id UUID NOT NULL REFERENCES renditions ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, rendition_id)
);
CREATE INDEX library_entries_user_idx ON library_entries (user_id, added_at DESC);

-- A pasted link: probed by a worker, then (playlists and channels) previewed in `entries`.
CREATE TABLE download_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  url TEXT NOT NULL,
  profile_id UUID NOT NULL REFERENCES format_profiles ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'probing' CHECK (state IN ('probing', 'choosing', 'queued', 'failed')),
  kind TEXT CHECK (kind IN ('video', 'playlist', 'channel')),
  title TEXT,
  entries JSONB NOT NULL DEFAULT '[]',
  error_kind TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 day'
);
CREATE INDEX download_requests_expiry_idx ON download_requests (expires_at) WHERE state = 'choosing';

-- One video a user asked for. `fetch_key` names the shared fetch (extractor, video, profile,
-- revision); `args` snapshots the profile when queued. It counts against the user's limit while
-- active and dispatched.
CREATE TABLE downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  request_id UUID REFERENCES download_requests ON DELETE SET NULL,
  profile_id UUID NOT NULL REFERENCES format_profiles ON DELETE RESTRICT,
  profile_revision TEXT NOT NULL,
  args JSONB NOT NULL,
  extractor TEXT NOT NULL,
  video_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  fetch_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  dispatched_at TIMESTAMPTZ,
  rendition_id UUID REFERENCES renditions ON DELETE SET NULL,
  error_kind TEXT,
  error_message TEXT,
  stderr_tail TEXT[] NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX downloads_one_active ON downloads (user_id, fetch_key)
  WHERE state IN ('queued', 'running');
CREATE INDEX downloads_user_idx ON downloads (user_id, created_at DESC);
CREATE INDEX downloads_fetch_idx ON downloads (fetch_key) WHERE state IN ('queued', 'running');

-- Library (docs/library.md). A media's subtitle files, captured at download time.
CREATE TABLE subtitles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES media ON DELETE CASCADE,
  lang TEXT NOT NULL,
  name TEXT,
  automatic BOOLEAN NOT NULL DEFAULT false,
  storage_key TEXT NOT NULL UNIQUE,
  UNIQUE (media_id, lang, automatic)
);

CREATE INDEX media_search_idx ON media USING GIN (search);

-- A playlist someone queued from a preview, its entries in order, and who queued it (a playlist
-- shows only to them). Channel tabs are not recorded: the channel page covers a channel.
CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extractor TEXT NOT NULL,
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('playlist')),
  title TEXT,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (extractor, source_id)
);

CREATE TABLE user_sources (
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES sources ON DELETE CASCADE,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source_id)
);

-- Joined to media by extractor and video id: a preview entry has no media row until fetched.
CREATE TABLE source_items (
  source_id UUID NOT NULL REFERENCES sources ON DELETE CASCADE,
  extractor TEXT NOT NULL,
  video_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (source_id, extractor, video_id)
);

CREATE TABLE entry_tags (
  entry_id UUID NOT NULL REFERENCES library_entries ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (tag = lower(btrim(tag)) AND char_length(tag) BETWEEN 1 AND 32),
  PRIMARY KEY (entry_id, tag)
);
CREATE INDEX entry_tags_tag_idx ON entry_tags (tag);

-- Per person and media, so two profiles of one video share it.
CREATE TABLE watch_progress (
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  media_id UUID NOT NULL REFERENCES media ON DELETE CASCADE,
  position_s DOUBLE PRECISION NOT NULL CHECK (position_s >= 0),
  duration_s DOUBLE PRECISION NOT NULL CHECK (duration_s > 0),
  watched BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, media_id)
);
