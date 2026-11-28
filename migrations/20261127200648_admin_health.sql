-- 20261127200648_admin_health.sql
-- Forward-only: never edit this file once it has been applied anywhere.


-- Admin › Health (docs/health.md). The release before reads neither table.

-- Each replica checks in here every 15 s once it has attached its database: a random id per
-- process, its host and pid (as `jobs.worker` names them), its version, whether it leads, and the
-- checks of its own that fail. A clean stop deletes its row; a row unseen for an hour is dropped.
-- Unlogged: a crash empties it, and every replica checks in again within 15 s.
CREATE UNLOGGED TABLE replicas (
  id UUID PRIMARY KEY,
  host TEXT NOT NULL,
  pid INTEGER NOT NULL,
  version TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  leader BOOLEAN NOT NULL DEFAULT false,
  failing TEXT[] NOT NULL DEFAULT '{}'
);
CREATE INDEX replicas_seen ON replicas (seen_at);

-- Every rate limit a site answered this server with (docs/downloads.md "Rate limits"), for the
-- admin: the site and the cooldown's scope, the kind of work it held, yt-dlp's message, the video
-- (its link and title, when known, and the stored one, `media_id`, when it held subtitles fetched
-- apart or a hover preview's copy, so the page links it in the library; null once it goes), and
-- the cooldown it set: until when, whether the site said (`hinted`) or it is the estimate, and the
-- limits in a row. Never a person. Kept a week.
CREATE TABLE rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  site TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('site', 'subtitles')),
  source TEXT NOT NULL CHECK (
    source IN ('download', 'link', 'search', 'subscription', 'preview', 'subtitles')
  ),
  message TEXT NOT NULL,
  url TEXT,
  title TEXT,
  media_id UUID REFERENCES media (id) ON DELETE SET NULL,
  until TIMESTAMPTZ NOT NULL,
  hinted BOOLEAN NOT NULL,
  strikes INTEGER NOT NULL CHECK (strikes > 0)
);
CREATE INDEX rate_limit_events_at ON rate_limit_events (at);
CREATE INDEX rate_limit_events_media ON rate_limit_events (media_id) WHERE media_id IS NOT NULL;
