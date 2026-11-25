-- 20261122000000_schema.sql
-- The whole schema, squashed. Uroboros has no deployed databases yet, so until the first release
-- this one file is edited in place instead of adding migrations; after changing it, reset local
-- databases (docs: CLAUDE.md "Database and tests"). Once a release ships, it becomes forward-only
-- like any migration and changes go into new files.

-- Trigram indexes for library search (docs/library.md "Search"): substring matches in any language.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
  -- What the token may reach: 'api' the REST API, 'mcp' the MCP server (docs/auth.md).
  scopes TEXT[] NOT NULL DEFAULT '{api}'
    CHECK (cardinality(scopes) BETWEEN 1 AND 2 AND scopes <@ ARRAY['api', 'mcp']::TEXT[]),
  -- A read-only token is refused every write: REST methods other than GET, HEAD and OPTIONS, and
  -- the MCP tools that change anything.
  read_only BOOLEAN NOT NULL DEFAULT false,
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
-- yt-dlp presets. A built-in (user_id null) is everyone's until a person changes it, which changes
-- it for them alone: editing makes it a profile of their own, deleting hides it (hidden_profiles).
-- Any other profile is its owner's alone (docs/downloads.md#format-profiles).
CREATE TABLE format_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 64),
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
  CHECK (audio_only = (audio_format IS NOT NULL)),
  -- The fallback default is a built-in; a person's own choice is in user_default_profiles.
  CHECK (NOT is_default OR user_id IS NULL),
  UNIQUE NULLS NOT DISTINCT (user_id, name)
);
CREATE UNIQUE INDEX format_profiles_one_default ON format_profiles ((true)) WHERE is_default;
CREATE INDEX format_profiles_user_idx ON format_profiles (user_id) WHERE user_id IS NOT NULL;

-- The built-ins a person deleted, or edited into a profile of their own: hidden from them alone.
CREATE TABLE hidden_profiles (
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES format_profiles ON DELETE CASCADE,
  PRIMARY KEY (user_id, profile_id)
);

-- The profile a person downloads with when they pick none: one they can see. Without a row, the
-- built-in default if they still see it, else their first profile.
CREATE TABLE user_default_profiles (
  user_id UUID PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES format_profiles ON DELETE CASCADE
);

-- The built-ins. Revisions are profileRevision() of each row's arguments, extra arguments in the
-- order given (apps/server/src/downloads/profiles.ts; its test pins these literals). "Best
-- available" is the default. All but the archive cut SponsorBlock's sponsor, self-promotion and
-- interaction-reminder segments; music also cuts non-music sections; the archive keeps the original
-- whole, with subtitles, chapters, metadata and cover embedded in MKV. Music is MP3 at VBR best
-- with metadata and cover art; podcasts are AAC with chapters; 720p is the smaller MP4.
INSERT INTO format_profiles
  (name, format, merge_format, audio_only, audio_format, extra_args, sponsorblock_remove,
   is_default, revision)
VALUES
  ('Best up to 1080p (MP4)',
   'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]',
   'mp4', false, NULL, '{}', '{interaction,selfpromo,sponsor}', false, '51218d6e714b'),
  ('Best available', 'bv*+ba/b', NULL, false, NULL, '{}', '{interaction,selfpromo,sponsor}', true,
   '425e43de8e2a'),
  ('Audio only (Opus)', 'ba/b', NULL, true, 'opus', '{}', '{interaction,selfpromo,sponsor}', false,
   '10ef9f0d7ccc'),
  ('Up to 720p (MP4)',
   'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]',
   'mp4', false, NULL, '{}', '{interaction,selfpromo,sponsor}', false, 'b9d7be37e099'),
  ('Music (MP3)', 'ba/b', NULL, true, 'mp3', '{--audio-quality=0,--embed-metadata,--embed-thumbnail}',
   '{interaction,music_offtopic,selfpromo,sponsor}', false, '4be16d1e85b2'),
  ('Podcasts (M4A)', 'ba[ext=m4a]/ba/b', NULL, true, 'm4a', '{--embed-metadata,--embed-chapters}',
   '{interaction,selfpromo,sponsor}', false, 'e2370ecd26d0'),
  ('Archive (MKV, uncut)', 'bv*+ba/b', 'mkv', false, NULL,
   '{--embed-metadata,--embed-chapters,--embed-subs,--embed-thumbnail}', '{}', false,
   '48abbab81015');

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
  -- The hover preview clip (docs/library.md "Hover previews"), once made; and when making it failed
  -- for good, so the backfill leaves it be.
  preview_key TEXT,
  preview_failed_at TIMESTAMPTZ,
  -- Who uploaded it, for an uploaded video (docs/uploads.md): only they may edit its details.
  uploaded_by UUID REFERENCES users ON DELETE SET NULL,
  -- [{start, end, title}] from the .info.json.
  chapters JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(chapters) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (extractor, video_id),
  -- An uploaded video's extractor is 'upload', which no site's is.
  CHECK (uploaded_by IS NULL OR extractor = 'upload')
);

-- One stored file per media, profile and profile revision.
CREATE TABLE renditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES media ON DELETE CASCADE,
  -- Null once the profile is gone (its owner's account deleted): nothing references the file then,
  -- and the reaper sweeps it.
  profile_id UUID REFERENCES format_profiles ON DELETE SET NULL,
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
  -- The SponsorBlock segments ({start, end, category}, on the file's own timeline) the player skips.
  -- A video keeps them in the file (marked as chapters); an audio file had them cut, so it has none.
  skip_segments JSONB NOT NULL DEFAULT '[]',
  -- Set by the reaper when no entry references it; cleared when one does again.
  orphaned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (media_id, profile_id, profile_revision),
  -- Two renditions never share a file.
  UNIQUE (storage_key)
);

-- Automation (docs/automation.md): a person following a channel's tabs or a playlist. Each is
-- checked when its next_check_at comes round (the leader queues the check); `feeds` are the
-- listings followed (`[{name, url, primedAt}]`, each primed by its own first check) and `tabs`
-- every tab the preview offered.
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
  -- NO ACTION, not RESTRICT: deleting an account removes its subscriptions and personal profiles
  -- in one statement, checked at its end.
  profile_id UUID NOT NULL REFERENCES format_profiles,
  -- When checks run: every interval_minutes, or on a 5-field cron in cron_tz (at most one); with
  -- neither, only when the person asks (Manually).
  interval_minutes INTEGER CHECK (interval_minutes BETWEEN 1 AND 10080),
  cron TEXT CHECK (char_length(cron) BETWEEN 9 AND 120),
  cron_tz TEXT CHECK (char_length(cron_tz) BETWEEN 1 AND 64),
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- When the next scheduled check is due; null while paused, and always for Manually.
  next_check_at TIMESTAMPTZ,
  notify BOOLEAN NOT NULL DEFAULT true,
  -- Whether a check queues what passes (true) or leaves it `new`, for the person to pick.
  auto_download BOOLEAN NOT NULL DEFAULT true,
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
  UNIQUE (user_id, extractor, source_id),
  CHECK (interval_minutes IS NULL OR cron IS NULL),
  CHECK ((cron IS NULL) = (cron_tz IS NULL)),
  CHECK (next_check_at IS NULL OR enabled),
  CHECK (next_check_at IS NULL OR interval_minutes IS NOT NULL OR cron IS NOT NULL)
);
CREATE INDEX subscriptions_due ON subscriptions (next_check_at) WHERE enabled;

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
-- Who has a media in their library (its preview's nudges, docs/library.md), and the cascade when it goes.
CREATE INDEX library_entries_media_idx ON library_entries (media_id);

-- A pasted link: probed by a worker, then (playlists and channels) previewed in `entries`.
CREATE TABLE download_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  url TEXT NOT NULL,
  profile_id UUID NOT NULL REFERENCES format_profiles ON DELETE CASCADE,
  -- Why the link was pasted: to download it, or (Subscriptions › Add subscription) to subscribe,
  -- in which case a single video is refused (not_a_feed) rather than downloaded.
  intent TEXT NOT NULL DEFAULT 'download' CHECK (intent IN ('download', 'subscribe', 'search')),
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
  -- The entries the person picked in the preview so far; NULL until they change anything, when
  -- the groups' own ticks stand.
  selected TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A preview waiting for a pick is held a day from when it is ready (the probe sets it), then
  -- swept; until then, past it, it reads as gone.
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
  -- NO ACTION, as for subscriptions: an account's downloads and profiles go together.
  profile_id UUID NOT NULL REFERENCES format_profiles,
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
-- A file's latest download, which a SponsorBlock refetch reads its profile arguments from; every
-- item page asks (src/library/skipRefetch.ts).
CREATE INDEX downloads_rendition_idx ON downloads (rendition_id, created_at DESC);

-- What a subscription has seen: an entry with a final outcome is never reconsidered (so a video
-- retention removed is not fetched again); `waiting` ones (upcoming, or held for the delay) are.
CREATE TABLE subscription_items (
  subscription_id UUID NOT NULL REFERENCES subscriptions ON DELETE CASCADE,
  extractor TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT,
  url TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome TEXT NOT NULL CHECK (outcome IN ('queued', 'new', 'filtered', 'existing', 'waiting')),
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
  -- When its captions were last read into caption_segments for search (docs/library.md "Search");
  -- null while that waits. Storing the file again sets it back to null.
  indexed_at TIMESTAMPTZ,
  -- Reads of the file that failed since the last that worked; at 3 search gives the track up.
  index_failures SMALLINT NOT NULL DEFAULT 0 CHECK (index_failures >= 0),
  UNIQUE (media_id, lang, automatic),
  UNIQUE (id, media_id)
);
CREATE INDEX subtitles_pending_idx ON subtitles (media_id) WHERE indexed_at IS NULL;

-- A subtitle track's captions as runs of lines (src/library/vtt.ts), for search: at most 400
-- characters and 30 seconds each, with where each line begins in the text (`line_at`, UTF-16
-- offsets) and when it starts (`line_start`), so a match plays from its own line. One track per
-- language is read (src/library/captionIndex.ts); the media's own id makes search find a video's
-- runs without the subtitles table, and the composite key keeps it the track's.
CREATE TABLE caption_segments (
  subtitle_id UUID NOT NULL,
  media_id UUID NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  start_s DOUBLE PRECISION NOT NULL CHECK (start_s >= 0),
  end_s DOUBLE PRECISION NOT NULL CHECK (end_s >= start_s),
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 400),
  line_at INTEGER[] NOT NULL,
  line_start DOUBLE PRECISION[] NOT NULL,
  CHECK (cardinality(line_at) = cardinality(line_start) AND cardinality(line_at) >= 1),
  PRIMARY KEY (subtitle_id, seq),
  FOREIGN KEY (subtitle_id, media_id) REFERENCES subtitles (id, media_id) ON DELETE CASCADE
);
CREATE INDEX caption_segments_text_idx ON caption_segments USING GIN (text gin_trgm_ops);
CREATE INDEX caption_segments_media_idx ON caption_segments (media_id, start_s);

-- Library search (docs/library.md "Search") matches substrings through trigram indexes over these
-- texts. The line breaks keep a phrase from running from one field into the next, and the channel is
-- the uploader when there is none, as the library shows it. The query repeats each indexed
-- expression (and the chapters' predicate) exactly, or Postgres cannot use the index.
CREATE FUNCTION media_search_text(title TEXT, channel TEXT, uploader TEXT, description TEXT)
  RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(title, '') || E'\n' || coalesce(channel, uploader, '') || E'\n' || coalesce(description, '')
$$;
CREATE INDEX media_search_idx ON media
  USING GIN (media_search_text(title, channel, uploader, description) gin_trgm_ops);
CREATE FUNCTION media_chapter_text(chapters JSONB) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(string_agg(c ->> 'title', E'\n' ORDER BY o), '')
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(chapters) = 'array' THEN chapters ELSE '[]' END)
    WITH ORDINALITY AS t (c, o)
  WHERE c ->> 'title' IS NOT NULL
$$;
CREATE INDEX media_chapters_search_idx ON media USING GIN (media_chapter_text(chapters) gin_trgm_ops)
  WHERE chapters <> '[]'::jsonb;

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

-- Groups people make (docs/sharing.md "Groups"): anyone creates one and runs it with the managers
-- they pick; every member sees it and can share with it. A name need not be unique.
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  -- Who made it, for the cap on groups a person makes (only those they are still in count).
  created_by UUID REFERENCES users ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX groups_created_by_idx ON groups (created_by);

CREATE TABLE group_members (
  group_id UUID NOT NULL REFERENCES groups ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  manager BOOLEAN NOT NULL DEFAULT false,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id);

-- A group keeps an enabled manager while it has an enabled member: with none, its earliest-added
-- enabled member (revoked accounts last) becomes one. The group row is locked first, so a member
-- leaving at the same moment is never the one promoted.
CREATE FUNCTION ensure_group_manager(gid UUID) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM groups WHERE id = gid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM group_members gm JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = gid AND gm.manager AND u.disabled_at IS NULL
  ) THEN
    RETURN;
  END IF;
  UPDATE group_members SET manager = true
  WHERE group_id = gid AND user_id = (
    SELECT gm.user_id FROM group_members gm JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = gid AND u.disabled_at IS NULL
    ORDER BY u.revoked_at IS NOT NULL, gm.added_at, gm.user_id
    LIMIT 1
  );
END $$;

-- However a member goes (leaving, removed, their account deleted): a group with nobody left goes
-- too, and one left without an enabled manager gets one.
CREATE FUNCTION group_member_gone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM groups WHERE id = OLD.group_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = OLD.group_id) THEN
    DELETE FROM groups WHERE id = OLD.group_id;
  ELSE
    PERFORM ensure_group_manager(OLD.group_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER group_members_gone AFTER DELETE ON group_members
  FOR EACH ROW EXECUTE FUNCTION group_member_gone();

-- A disabled manager (all that ever happens to an SSO account) no longer runs their groups; a
-- re-enabled member can run a group left with no enabled manager while they were away.
CREATE FUNCTION user_disabled_groups() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  gid UUID;
BEGIN
  FOR gid IN
    SELECT group_id FROM group_members
    WHERE user_id = NEW.id AND (manager OR NEW.disabled_at IS NULL)
    ORDER BY group_id
  LOOP
    PERFORM ensure_group_manager(gid);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER users_disabled_groups AFTER UPDATE OF disabled_at ON users
  FOR EACH ROW WHEN (OLD.disabled_at IS DISTINCT FROM NEW.disabled_at)
  EXECUTE FUNCTION user_disabled_groups();

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

-- Who a people-share reaches: a user, or everyone in one of the owner's groups (`groups`) at the
-- moment they ask.
CREATE TABLE share_people (
  share_id UUID NOT NULL REFERENCES shares ON DELETE CASCADE,
  user_id UUID REFERENCES users ON DELETE CASCADE,
  group_id UUID REFERENCES groups ON DELETE CASCADE,
  CHECK (num_nonnulls(user_id, group_id) = 1)
);
CREATE INDEX share_people_share_idx ON share_people (share_id);
CREATE UNIQUE INDEX share_people_user_key ON share_people (share_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX share_people_group_key ON share_people (share_id, group_id)
  WHERE group_id IS NOT NULL;
CREATE INDEX share_people_user_idx ON share_people (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX share_people_group_idx ON share_people (group_id) WHERE group_id IS NOT NULL;

-- A people-share with nobody left ends: its only group deleted, its only person's account
-- deleted, or its owner out of the group it named. Checked at commit, so replacing a share's
-- people in one transaction (delete, then insert) keeps it.
CREATE FUNCTION end_empty_people_share() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM shares s
  WHERE s.id = OLD.share_id AND s.mode = 'people'
    AND NOT EXISTS (SELECT 1 FROM share_people sp WHERE sp.share_id = OLD.share_id);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER share_people_end_empty AFTER DELETE ON share_people
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION end_empty_people_share();

-- Which kinds of push notification a person wants; no row means all of them.
CREATE TABLE notification_prefs (
  user_id UUID PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  downloads BOOLEAN NOT NULL DEFAULT true,
  shares BOOLEAN NOT NULL DEFAULT true,
  groups BOOLEAN NOT NULL DEFAULT true
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
-- until a remux has its keyframes. Its segments live under `.transcodes/<id>/` while it runs; its
-- short-lived state is in playback_live and playback_segments.
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

-- A live session's short-lived state (docs/transcoding.md): until when its viewer counts as there
-- (alive_until, pushed on by every request and ping), and which run owns it (run_id: a runner whose
-- token is no longer this one stops writing). Unlogged: a crash empties it, and the pages start
-- their sessions again. It goes with its session.
CREATE UNLOGGED TABLE playback_live (
  session_id UUID PRIMARY KEY REFERENCES playback_sessions ON DELETE CASCADE,
  alive_until TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
  run_id UUID
);

-- The segments a live session has stored (the init is -1). Unlogged; it goes with its session.
CREATE UNLOGGED TABLE playback_segments (
  session_id UUID NOT NULL REFERENCES playback_sessions ON DELETE CASCADE,
  n INTEGER NOT NULL CHECK (n BETWEEN -1 AND 999999),
  PRIMARY KEY (session_id, n)
);

-- A session's row can go many ways (swept, or with its entry, rendition or link); its folder goes
-- to the trash each time, so a runner that died before cleaning up never leaves files behind.
CREATE FUNCTION trash_playback_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO storage_trash (key) VALUES ('.transcodes/' || OLD.id || '/')
    ON CONFLICT (key) DO NOTHING;
  RETURN OLD;
END
$$;

-- Storage keys whose rows are gone and whose files the reaper still has to delete. A key ending in
-- `/` is a prefix: everything under it goes.
CREATE TABLE storage_trash (
  key TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER playback_sessions_trash BEFORE DELETE ON playback_sessions
  FOR EACH ROW EXECUTE FUNCTION trash_playback_session();

-- The job queue (docs/jobs.md): a row per job, waiting (`queued`, due at run_at) or running (held by
-- the run whose random token is locked_by, until locked_until, which its worker renews). A finished
-- job's row is deleted, so every row is live: a second job with a live key is refused, and a key
-- can be used again once its job is done.
CREATE TABLE jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue TEXT NOT NULL CHECK (queue IN ('probe', 'download', 'notify', 'playback', 'automation', 'upload', 'export', 'preview')),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 32),
  key TEXT CHECK (char_length(key) >= 1),
  data JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running')),
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Runs started, counted when a worker claims the job; a run put back unfinished gives its back.
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts >= 1),
  backoff TEXT NOT NULL DEFAULT 'fixed' CHECK (backoff IN ('fixed', 'exponential')),
  backoff_ms INTEGER NOT NULL DEFAULT 0 CHECK (backoff_ms >= 0),
  -- Runs whose worker vanished (its lease lapsed); past max_stalls the job is dropped.
  stalls INTEGER NOT NULL DEFAULT 0 CHECK (stalls >= 0),
  max_stalls INTEGER NOT NULL CHECK (max_stalls >= 0),
  locked_by UUID,
  locked_until TIMESTAMPTZ,
  -- The worker process (host:pid) running it, for logs and pg_stat_activity.
  worker TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((state = 'running') = (locked_by IS NOT NULL)),
  CHECK ((locked_by IS NULL) = (locked_until IS NULL))
);
CREATE UNIQUE INDEX jobs_live_key ON jobs (queue, key) WHERE key IS NOT NULL;
CREATE INDEX jobs_due ON jobs (queue, run_at, id) WHERE state = 'queued';
CREATE INDEX jobs_leases ON jobs (locked_until) WHERE state = 'running';

-- When a rate-limited queue may start its next job, across every replica. Unlogged: a crash that
-- empties it only lets one job start early.
CREATE UNLOGGED TABLE job_limits (
  queue TEXT PRIMARY KEY,
  next_start_at TIMESTAMPTZ NOT NULL
);

-- The latest progress of each running fetch, for pages that load mid-download (live pages hear it
-- on the bus). Unlogged and short-lived: readers skip expired rows, the leader sweeps them.
CREATE UNLOGGED TABLE download_progress (
  fetch_key TEXT PRIMARY KEY,
  progress JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX download_progress_expiry ON download_progress (expires_at);

-- Failed sign-ins in their 15-minute window, per username from one client IP (`user_ip`, value
-- `name|ip`), per username (`user`) and per client IP (`ip`) (docs/auth.md), shared by every
-- replica. Unlogged: a crash restarts the windows. The leader sweeps expired rows.
CREATE UNLOGGED TABLE signin_failures (
  kind TEXT NOT NULL CHECK (kind IN ('user_ip', 'user', 'ip')),
  value TEXT NOT NULL,
  failures INTEGER NOT NULL CHECK (failures >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (kind, value)
);
CREATE INDEX signin_failures_expiry ON signin_failures (expires_at);

-- Uploads (docs/uploads.md): a person's own video, sent from their browser in parts straight into
-- the media store (`store_upload_id` is the store's id for it), then filed by the `upload` job as a
-- media row of its own (`media_id`), a rendition without a profile and the person's entry. A done
-- row stays a day so the browser finds its entry; a failed one a week, so its person sees why.
CREATE TABLE uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Null once the person's account is gone: the sweep then drops the upload and its storage.
  user_id UUID REFERENCES users ON DELETE SET NULL,
  media_id UUID NOT NULL DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  -- Every part but the last is this many bytes.
  part_bytes INTEGER NOT NULL CHECK (part_bytes > 0),
  ext TEXT NOT NULL CHECK (ext IN ('mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description TEXT CHECK (char_length(description) <= 5000),
  creator TEXT NOT NULL CHECK (char_length(creator) BETWEEN 1 AND 100),
  tags TEXT[] NOT NULL DEFAULT '{}',
  storage_key TEXT NOT NULL UNIQUE,
  store_upload_id TEXT NOT NULL,
  thumbnail_key TEXT,
  state TEXT NOT NULL DEFAULT 'receiving'
    CHECK (state IN ('receiving', 'processing', 'done', 'failed')),
  -- Why it failed, in words for its person.
  error TEXT,
  entry_id UUID REFERENCES library_entries ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The last part or change; a receiving upload untouched for a day is dropped.
  touched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX uploads_unfinished ON uploads (user_id) WHERE state IN ('receiving', 'processing');
CREATE INDEX uploads_state ON uploads (state, touched_at);

-- The parts of an upload the store holds; their etags and checksums complete it.
CREATE TABLE upload_parts (
  upload_id UUID NOT NULL REFERENCES uploads ON DELETE CASCADE,
  n INTEGER NOT NULL CHECK (n BETWEEN 1 AND 10000),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  etag TEXT NOT NULL,
  checksum TEXT,
  PRIMARY KEY (upload_id, n)
);

-- Copies of a video without its SponsorBlock segments, made to save to a device (docs/transcoding.md
-- "Saving without SponsorBlock segments"): the `export` job re-encodes the entry's file with `cuts`
-- (the merged spans removed, on the file's timeline) taken out, and stores it at `storage_key`
-- (`.exports/<id>.mp4`). Each person's own, kept until they remove it; deleting the row (also
-- through its person, entry or file going) trashes the file.
CREATE TABLE exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES library_entries ON DELETE CASCADE,
  rendition_id UUID NOT NULL REFERENCES renditions ON DELETE CASCADE,
  cuts JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed')),
  -- How far the encode is, 0 to 1, while it runs.
  progress REAL CHECK (progress BETWEEN 0 AND 1),
  -- The encoder it ran on (libx264, nvenc or vaapi).
  encoder TEXT,
  storage_key TEXT UNIQUE,
  size_bytes BIGINT CHECK (size_bytes >= 0),
  -- Why it failed, in words for its person.
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CHECK ((state = 'done') = (storage_key IS NOT NULL AND size_bytes IS NOT NULL)),
  CHECK ((state IN ('done', 'failed')) = (finished_at IS NOT NULL))
);
CREATE INDEX exports_user ON exports (user_id, created_at);

CREATE FUNCTION trash_export() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.storage_key IS NOT NULL THEN
    INSERT INTO storage_trash (key) VALUES (OLD.storage_key) ON CONFLICT (key) DO NOTHING;
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER exports_trash BEFORE DELETE ON exports
  FOR EACH ROW EXECUTE FUNCTION trash_export();

-- Everything the server told a person (docs/push.md#the-list-in-the-app), pushed to their devices
-- or not: the bell's list. A newer notice with the same tag replaces the older one (an untagged one
-- never does); the leader drops them after 30 days.
CREATE TABLE notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('downloads', 'shares', 'subscriptions', 'groups')),
  title TEXT NOT NULL CHECK (title <> ''),
  body TEXT,
  -- Where it leads in the app.
  path TEXT NOT NULL CHECK (path LIKE '/%'),
  tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  UNIQUE (user_id, tag)
);
CREATE INDEX notices_user ON notices (user_id, created_at DESC);
