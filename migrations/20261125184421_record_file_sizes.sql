-- 20261125184421_record_file_sizes.sql
-- Forward-only: never edit this file once it has been applied anywhere.

-- Every stored file's size, for Admin › Stats (docs/library.md "Stats"). Renditions, copies to
-- save and upload parts had theirs; thumbnails, .info.json files, hover previews, subtitles and a
-- playback session's segments get theirs here. Null is "not measured yet": the code that stores a
-- file records its size, and the leader measures the rest (src/storage/measure.ts), the files
-- stored before this release and those the release before stores while both run.
ALTER TABLE media
  ADD COLUMN thumbnail_bytes BIGINT CHECK (thumbnail_bytes >= 0),
  ADD COLUMN info_bytes BIGINT CHECK (info_bytes >= 0),
  ADD COLUMN preview_bytes BIGINT CHECK (preview_bytes >= 0);
ALTER TABLE subtitles ADD COLUMN size_bytes BIGINT CHECK (size_bytes >= 0);
ALTER TABLE playback_segments ADD COLUMN size_bytes INTEGER CHECK (size_bytes >= 0);

-- A size goes with its key: a statement that changes a key without giving the new file's size
-- (the release before knows no sizes) forgets the old one, so the leader measures the new file.
CREATE FUNCTION forget_media_sizes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.thumbnail_key IS DISTINCT FROM OLD.thumbnail_key
    AND NEW.thumbnail_bytes IS NOT DISTINCT FROM OLD.thumbnail_bytes THEN
    NEW.thumbnail_bytes := NULL;
  END IF;
  IF NEW.info_key IS DISTINCT FROM OLD.info_key
    AND NEW.info_bytes IS NOT DISTINCT FROM OLD.info_bytes THEN
    NEW.info_bytes := NULL;
  END IF;
  IF NEW.preview_key IS DISTINCT FROM OLD.preview_key
    AND NEW.preview_bytes IS NOT DISTINCT FROM OLD.preview_bytes THEN
    NEW.preview_bytes := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER media_forget_sizes BEFORE UPDATE ON media
  FOR EACH ROW EXECUTE FUNCTION forget_media_sizes();

CREATE FUNCTION forget_subtitle_size() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key
    AND NEW.size_bytes IS NOT DISTINCT FROM OLD.size_bytes THEN
    NEW.size_bytes := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER subtitles_forget_size BEFORE UPDATE ON subtitles
  FOR EACH ROW EXECUTE FUNCTION forget_subtitle_size();
