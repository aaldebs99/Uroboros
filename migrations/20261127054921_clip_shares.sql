-- 20261127054921_clip_shares.sql
-- Forward-only: never edit this file once it has been applied anywhere.


-- Clips shared on their own (docs/sharing.md#clips): with people and groups, or by a public link,
-- the owner's own copy of one range of their own entry (`exports` with a clip), never the rest of
-- the video. Kept apart from `shares`, whose every row the release before reads as a whole entry,
-- playlist or YouTube playlist: it never reads these, so on it a clip link is a dead link and the
-- lists leave clips out. The same rules as `shares`: one people-share and one link per clip, a link
-- has a code, only a link chooses downloads, and the share goes with its copy or its entry.
CREATE TABLE clip_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  export_id UUID NOT NULL,
  entry_id UUID NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('people', 'link')),
  code TEXT UNIQUE,
  allow_download BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((mode = 'link') = (code IS NOT NULL)),
  CHECK (mode = 'link' OR NOT allow_download),
  FOREIGN KEY (export_id, owner_id, entry_id) REFERENCES exports (id, user_id, entry_id)
    ON DELETE CASCADE,
  FOREIGN KEY (entry_id, owner_id) REFERENCES library_entries (id, user_id) ON DELETE CASCADE,
  UNIQUE (mode, export_id)
);
CREATE INDEX clip_shares_owner_idx ON clip_shares (owner_id, updated_at DESC);
-- Retention keeps a video with a shared clip, as it keeps a shared one.
CREATE INDEX clip_shares_entry_idx ON clip_shares (entry_id);

-- Who a clip's people-share reaches, as `share_people` for `shares`.
CREATE TABLE clip_share_people (
  share_id UUID NOT NULL REFERENCES clip_shares ON DELETE CASCADE,
  user_id UUID REFERENCES users ON DELETE CASCADE,
  group_id UUID REFERENCES groups ON DELETE CASCADE,
  CHECK (num_nonnulls(user_id, group_id) = 1)
);
CREATE INDEX clip_share_people_share_idx ON clip_share_people (share_id);
CREATE UNIQUE INDEX clip_share_people_user_key ON clip_share_people (share_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX clip_share_people_group_key ON clip_share_people (share_id, group_id)
  WHERE group_id IS NOT NULL;
CREATE INDEX clip_share_people_user_idx ON clip_share_people (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX clip_share_people_group_idx ON clip_share_people (group_id)
  WHERE group_id IS NOT NULL;

-- A clip's people-share with nobody left ends, checked at commit, as end_empty_people_share does.
CREATE FUNCTION end_empty_clip_share() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM clip_shares s
  WHERE s.id = OLD.share_id AND s.mode = 'people'
    AND NOT EXISTS (SELECT 1 FROM clip_share_people sp WHERE sp.share_id = OLD.share_id);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER clip_share_people_end_empty AFTER DELETE ON clip_share_people
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION end_empty_clip_share();
