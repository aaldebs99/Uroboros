-- 20261128022852_audio_presets_stereo.sql
-- Forward-only: never edit this file once it has been applied anywhere.


-- The built-in audio profiles take stereo first, and Opus as the site serves it (docs/downloads.md
-- "Format profiles"). yt-dlp ranks a format's channels above its codec, so a bare `ba/b` took
-- YouTube's AAC 5.1 where a video has one: converted into Opus rather than keeping YouTube's own
-- Opus, downmixed into MP3, and three times the size in M4A. Each revision is profileRevision's
-- (profiles.test.ts checks), so new downloads fetch new files; files already kept stay. A row only
-- changes while it still has the revision it was seeded with, so a built-in an admin has edited
-- keeps the edit. The release before reads these rows as it reads any profile's.
UPDATE format_profiles
SET format = 'ba[acodec=opus]/ba[audio_channels<=2]/ba/b', revision = '2e7ca19af0a9',
  updated_at = now()
WHERE user_id IS NULL AND name = 'Audio only (Opus)' AND revision = '52c4824db249';

UPDATE format_profiles
SET format = 'ba[audio_channels<=2]/ba/b', revision = '4f2bb5a1099a', updated_at = now()
WHERE user_id IS NULL AND name = 'Music (MP3)' AND revision = '55ef7144ff02';

UPDATE format_profiles
SET format = 'ba[ext=m4a][audio_channels<=2]/ba[ext=m4a]/ba/b', revision = '25f15f2277d7',
  updated_at = now()
WHERE user_id IS NULL AND name = 'Podcasts (M4A)' AND revision = '0589cfa5ee0d';
