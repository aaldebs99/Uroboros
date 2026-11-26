-- 20261126051111_profile_video_codec.sql
-- Forward-only: never edit this file once it has been applied anywhere.

-- A profile may prefer a video codec among copies of one height, the highest resolution still first
-- (docs/downloads.md "Format profiles"); null leaves yt-dlp's own order. The release before never
-- reads it, and downloads with the same selector and container, in yt-dlp's order.
ALTER TABLE format_profiles
  ADD COLUMN video_codec TEXT CHECK (video_codec IN ('av1', 'vp9', 'h265', 'h264')),
  ADD CONSTRAINT format_profiles_codec_is_video CHECK (NOT audio_only OR video_codec IS NULL);

-- The built-in video profiles download AV1 in MP4 at the heights their names say. Their old
-- selectors asked for `ext=mp4`, which YouTube's AV1 passes anyway; the container is now the merge
-- format, and the audio AAC (src/downloads/profiles.ts). Each revision is profileRevision's
-- (profiles.test.ts checks), so new downloads fetch new files; files already kept stay.
UPDATE format_profiles
SET format = 'bv*+ba/b', merge_format = 'mp4', video_codec = 'av1', revision = '44b50df82f50',
  updated_at = now()
WHERE user_id IS NULL AND name = 'Best available';

UPDATE format_profiles
SET format = 'bv*[height<=1080]+ba/b[height<=1080]', merge_format = 'mp4', video_codec = 'av1',
  revision = 'e81b46ea2777', updated_at = now()
WHERE user_id IS NULL AND name = 'Best up to 1080p (MP4)';

UPDATE format_profiles
SET format = 'bv*[height<=720]+ba/b[height<=720]', merge_format = 'mp4', video_codec = 'av1',
  revision = '57cf97650bd4', updated_at = now()
WHERE user_id IS NULL AND name = 'Up to 720p (MP4)';
