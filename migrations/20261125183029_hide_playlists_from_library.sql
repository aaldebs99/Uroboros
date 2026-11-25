-- 20261125183029_hide_playlists_from_library.sql
-- Forward-only: never edit this file once it has been applied anywhere.

-- Hidden playlists (docs/library.md): a playlist can keep its videos out of Library › Videos and
-- Audio. A manual playlist hides for its owner; a YouTube playlist, shared by everyone who has it,
-- hides for each person on their own `user_sources` row.
ALTER TABLE playlists ADD COLUMN hide_from_library BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_sources ADD COLUMN hide_from_library BOOLEAN NOT NULL DEFAULT false;

-- This replaces the account-wide Hide playlist videos setting: whoever had it on keeps the library
-- they saw, every playlist they have now hiding its own videos.
UPDATE playlists AS p
SET hide_from_library = true
FROM user_preferences AS up
WHERE up.user_id = p.user_id AND up.hide_playlist_videos;

UPDATE user_sources AS us
SET hide_from_library = true
FROM user_preferences AS up
WHERE up.user_id = us.user_id AND up.hide_playlist_videos;

-- user_preferences.hide_playlist_videos is read no more from this release on; the previous one
-- still reads it while both run, so a later release drops it.
