-- 20261126183733_save_links.sql
-- Forward-only: never edit this file once it has been applied anywhere.


-- A short-lived link that saves one file without the session cookie (docs/downloads.md#saving-a-file):
-- the installed iPhone app hands Save to Safari, which doesn't have the app's cookies, so Safari
-- gets this link instead. Only the token's SHA-256 is kept, as auth_sessions keeps its tokens'. It
-- names an entry (the person's own, or one shared with them, checked again on each use) or one of
-- their finished copies, and works for any number of requests (ranges) until it expires; the
-- sweeper deletes it after. The release before never reads it.
CREATE TABLE save_links (
  token_hash BYTEA PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  entry_id UUID REFERENCES library_entries ON DELETE CASCADE,
  export_id UUID REFERENCES exports ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK ((entry_id IS NULL) <> (export_id IS NULL))
);
CREATE INDEX save_links_expiry_idx ON save_links (expires_at);
