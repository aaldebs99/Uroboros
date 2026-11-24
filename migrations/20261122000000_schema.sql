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

-- A person's saved login for one site yt-dlp can sign in to, keyed by its netrc machine name
-- ("vimeo"). The password is sealed with UROBOROS_SECRETS_KEY (AES-256-GCM: nonce, ciphertext,
-- tag; the additional data names the user and the site) and never leaves the server: the jobs
-- open it into a private .netrc for one yt-dlp run (docs/downloads.md).
CREATE TABLE site_logins (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  site TEXT NOT NULL CHECK (site ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  username TEXT NOT NULL CHECK (char_length(username) BETWEEN 1 AND 256),
  password_sealed BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, site)
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
  -- SponsorBlock categories cut from the file (docs/automation.md); hashed into the revision.
  sponsorblock_remove TEXT[] NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  revision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (audio_only = (audio_format IS NOT NULL))
);
CREATE UNIQUE INDEX format_profiles_one_default ON format_profiles ((true)) WHERE is_default;

-- Revisions are profileRevision() of each row's arguments (apps/server/src/downloads/profiles.ts;
-- its test pins these literals). "Best available" is the default, and every seeded profile cuts
-- SponsorBlock's sponsor, self-promotion and interaction-reminder segments.
INSERT INTO format_profiles
  (name, format, merge_format, audio_only, audio_format, sponsorblock_remove, is_default, revision)
VALUES
  ('Best up to 1080p (MP4)',
   'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]',
   'mp4', false, NULL, '{interaction,selfpromo,sponsor}', false, '51218d6e714b'),
  ('Best available', 'bv*+ba/b', NULL, false, NULL, '{interaction,selfpromo,sponsor}', true,
   '425e43de8e2a'),
  ('Audio only (Opus)', 'ba/b', NULL, true, 'opus', '{interaction,selfpromo,sponsor}', false,
   '10ef9f0d7ccc');

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
  -- RFC 6381 codec strings of the video and audio streams (docs/transcoding.md), so the web app
  -- can ask the browser about the file itself.
  video_codecs TEXT,
  audio_codecs TEXT,
  -- Set by the reaper when no entry references it; cleared when one does again.
  orphaned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (media_id, profile_id, profile_revision),
  -- Two renditions never share a file.
  UNIQUE (storage_key)
);

-- Automation (docs/automation.md): a person following a channel's tabs or a playlist. Each is
-- checked on its own BullMQ job scheduler; `feeds` are the listings followed (`[{name, url,
-- primedAt}]`, each primed by its own first check) and `tabs` every tab the preview offered.
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('channel', 'playlist')),
  extractor TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT,
  url TEXT NOT NULL,
  feeds JSONB NOT NULL,
  tabs JSONB NOT NULL,
  profile_id UUID NOT NULL REFERENCES format_profiles ON DELETE RESTRICT,
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes BETWEEN 1 AND 10080),
  enabled BOOLEAN NOT NULL DEFAULT true,
  notify BOOLEAN NOT NULL DEFAULT true,
  title_include TEXT,
  title_exclude TEXT,
  min_duration_s INTEGER CHECK (min_duration_s >= 0),
  max_duration_s INTEGER CHECK (max_duration_s >= 0),
  uploaded_after DATE,
  exclude_shorts BOOLEAN NOT NULL DEFAULT false,
  exclude_live BOOLEAN NOT NULL DEFAULT false,
  delay_hours INTEGER NOT NULL DEFAULT 0 CHECK (delay_hours BETWEEN 0 AND 168),
  backfill TEXT NOT NULL CHECK (backfill IN ('none', 'newest', 'all')),
  backfill_count INTEGER CHECK (backfill_count > 0),
  keep_last INTEGER CHECK (keep_last > 0),
  delete_watched_after_days INTEGER CHECK (delete_watched_after_days > 0),
  last_checked_at TIMESTAMPTZ,
  last_error_kind TEXT,
  last_error_message TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  -- A check holds this while it runs, so two never run at once.
  lease_until TIMESTAMPTZ,
  -- Why the last check was incomplete (a playlist past the entry cap), or null.
  warning TEXT,
  -- When the filters last changed: a check that started before it records nothing.
  filters_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, extractor, source_id)
);

-- A user's library: entries pointing at shared renditions. Removing one deletes the row only.
-- Restrict, not cascade: the reaper deleting a rendition that just gained an entry must fail, never
-- take the entry with it. `subscription_id` is the subscription that brought it (retention's
-- scope); `kept` exempts it from retention.
CREATE TABLE library_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  media_id UUID NOT NULL REFERENCES media ON DELETE CASCADE,
  rendition_id UUID NOT NULL REFERENCES renditions ON DELETE RESTRICT,
  subscription_id UUID REFERENCES subscriptions ON DELETE SET NULL,
  kept BOOLEAN NOT NULL DEFAULT false,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, rendition_id),
  -- The target of the composite keys that keep a playlist's items and shares their owner's.
  UNIQUE (id, user_id)
);
CREATE INDEX library_entries_subscription_idx ON library_entries (subscription_id)
  WHERE subscription_id IS NOT NULL;
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
  -- A failed probe's last stderr lines from yt-dlp, redacted, shown under the error.
  stderr_tail TEXT[] NOT NULL DEFAULT '{}',
  -- A playlist's own id, so queueing it records the playlist (docs/library.md).
  source_extractor TEXT,
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 day',
  -- When its Ready or Failed notification went out; cleared when a download of it is queued
  -- again, so the next time nothing is pending it notifies once more (docs/sharing.md).
  noticed_at TIMESTAMPTZ
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
  -- 0 first: pasted links and new uploads; 1 behind them: a subscription's backfill.
  priority SMALLINT NOT NULL DEFAULT 0 CHECK (priority IN (0, 1)),
  subscription_id UUID REFERENCES subscriptions ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX downloads_one_active ON downloads (user_id, fetch_key)
  WHERE state IN ('queued', 'running');
CREATE INDEX downloads_user_idx ON downloads (user_id, created_at DESC);
CREATE INDEX downloads_fetch_idx ON downloads (fetch_key) WHERE state IN ('queued', 'running');

-- What a subscription has seen: an entry with a final outcome is never reconsidered (so a video
-- retention removed is not fetched again); `waiting` ones (upcoming, or held for the delay) are.
CREATE TABLE subscription_items (
  subscription_id UUID NOT NULL REFERENCES subscriptions ON DELETE CASCADE,
  extractor TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT,
  url TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome TEXT NOT NULL CHECK (outcome IN ('queued', 'filtered', 'existing', 'waiting')),
  reason TEXT,
  due_at TIMESTAMPTZ,
  download_id UUID REFERENCES downloads ON DELETE SET NULL,
  -- Part of the backfill (decided on its feed's first check, or held back then): queued at
  -- priority 1, with no notification, whenever it is finally decided.
  backfill BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (subscription_id, extractor, video_id)
);
CREATE INDEX subscription_items_recent_idx ON subscription_items (subscription_id, seen_at DESC);

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
  -- When it first counted as watched (retention's "watched X days ago"); null while unwatched.
  watched_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, media_id)
);

-- Playlists and sharing (docs/sharing.md). A manual playlist holds its owner's entries in order;
-- the composite keys make an item or a share of someone else's entry impossible.
CREATE TABLE playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  description TEXT CHECK (char_length(description) <= 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE INDEX playlists_user_idx ON playlists (user_id, updated_at DESC);

CREATE TABLE playlist_items (
  playlist_id UUID NOT NULL,
  user_id UUID NOT NULL,
  entry_id UUID NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, entry_id),
  FOREIGN KEY (playlist_id, user_id) REFERENCES playlists (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (entry_id, user_id) REFERENCES library_entries (id, user_id) ON DELETE CASCADE
);
CREATE INDEX playlist_items_entry_idx ON playlist_items (entry_id);

-- A share of one thing (an entry, a manual playlist, or a YouTube playlist the owner has), either
-- with people (`share_people`) or as a public link (`code`, 128 random bits in base64url). Each
-- thing has at most one of each mode per owner.
CREATE TABLE shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  entry_id UUID,
  playlist_id UUID,
  source_id UUID,
  mode TEXT NOT NULL CHECK (mode IN ('people', 'link')),
  code TEXT UNIQUE,
  allow_download BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(entry_id, playlist_id, source_id) = 1),
  CHECK ((mode = 'link') = (code IS NOT NULL)),
  CHECK (mode = 'link' OR NOT allow_download),
  FOREIGN KEY (entry_id, owner_id) REFERENCES library_entries (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (playlist_id, owner_id) REFERENCES playlists (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, source_id) REFERENCES user_sources (user_id, source_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX shares_entry_key ON shares (mode, entry_id) WHERE entry_id IS NOT NULL;
CREATE UNIQUE INDEX shares_playlist_key ON shares (mode, playlist_id) WHERE playlist_id IS NOT NULL;
CREATE UNIQUE INDEX shares_source_key ON shares (owner_id, mode, source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX shares_owner_idx ON shares (owner_id, updated_at DESC);

-- Who a people-share reaches: a user, or everyone whose `users.groups` holds the group name.
CREATE TABLE share_people (
  share_id UUID NOT NULL REFERENCES shares ON DELETE CASCADE,
  user_id UUID REFERENCES users ON DELETE CASCADE,
  group_name TEXT CHECK (char_length(group_name) BETWEEN 1 AND 256),
  CHECK (num_nonnulls(user_id, group_name) = 1)
);
CREATE UNIQUE INDEX share_people_user_key ON share_people (share_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX share_people_group_key ON share_people (share_id, group_name)
  WHERE group_name IS NOT NULL;
CREATE INDEX share_people_user_idx ON share_people (user_id) WHERE user_id IS NOT NULL;

-- Which kinds of push notification a person wants; no row means all of them.
CREATE TABLE notification_prefs (
  user_id UUID PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  downloads BOOLEAN NOT NULL DEFAULT true,
  shares BOOLEAN NOT NULL DEFAULT true
);

-- Transcoding (docs/transcoding.md): a compatible HLS copy of a rendition, made on demand for
-- browsers that cannot play the file and kept while used. Its files live under
-- `.transcodes/<id>/<attempt>/`; `encoder` is fixed when it is made, and `settings` revises the
-- encode settings with it, so changing either makes new copies.
CREATE TABLE transcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_rendition_id UUID NOT NULL REFERENCES renditions ON DELETE CASCADE,
  encoder TEXT NOT NULL CHECK (encoder IN ('libx264', 'nvenc')),
  settings TEXT NOT NULL,
  mode TEXT CHECK (mode IN ('encode', 'remux', 'audio')),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  ready_segments INTEGER NOT NULL DEFAULT 0,
  duration DOUBLE PRECISION,
  progress DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- The variant's RFC 6381 codecs and its resolution, for the multivariant playlist.
  codecs TEXT,
  resolution TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_rendition_id, settings)
);

-- A video's keyframe times in seconds from the file's start, sorted: where a playback session that
-- copies the video (a remux) can cut segments (docs/transcoding.md). Written by the fetch consumer
-- after a download, or by the first session that needs it.
CREATE TABLE rendition_keyframes (
  rendition_id UUID PRIMARY KEY REFERENCES renditions ON DELETE CASCADE,
  times DOUBLE PRECISION[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One viewer's playback of one entry, transcoded or remuxed on the fly (docs/transcoding.md): a
-- signed-in person, or a public link's code (the session goes when the link does). `plan` is what
-- it serves (sessionPlan.ts); `boundaries` the segments' start times and, last, the end, null
-- until a remux has its keyframes. Its segments live under `.transcodes/<id>/` while it runs; the
-- hot state (wanted and stored segments, liveness) is in Valkey.
CREATE TABLE playback_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rendition_id UUID NOT NULL REFERENCES renditions ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES library_entries ON DELETE CASCADE,
  user_id UUID REFERENCES users ON DELETE CASCADE,
  share_code TEXT REFERENCES shares (code) ON DELETE CASCADE,
  quality TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('remux', 'encode', 'audio')),
  plan JSONB NOT NULL,
  boundaries DOUBLE PRECISION[],
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'starting', 'running', 'stopped', 'failed')),
  encoder TEXT CHECK (encoder IN ('copy', 'libx264', 'nvenc', 'vaapi')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at TIMESTAMPTZ,
  CHECK ((user_id IS NULL) <> (share_code IS NULL))
);
CREATE INDEX playback_sessions_viewer ON playback_sessions (entry_id, user_id, share_code)
  WHERE state IN ('queued', 'starting', 'running');
CREATE INDEX playback_sessions_ended ON playback_sessions (stopped_at)
  WHERE state IN ('stopped', 'failed');

-- Storage keys whose rows are gone and whose files the reaper still has to delete. A key ending in
-- `/` is a prefix: everything under it goes.
CREATE TABLE storage_trash (
  key TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
