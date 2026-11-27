-- 20261127052648_clip_copies.sql
-- Forward-only: never edit this file once it has been applied anywhere.


-- Clips (docs/sharing.md#clips): a copy that keeps one range of the entry's file, `clip_start` to
-- `clip_end` (seconds on its timeline), instead of cutting its SponsorBlock segments. A clip also
-- writes that range's complement as `cuts`, so a worker of the release before, which reads only
-- `cuts`, makes the same clip from the job rather than the whole video. Both null on a copy without
-- sponsors, which the release before is the only kind it knows.
ALTER TABLE exports
  ADD COLUMN clip_start DOUBLE PRECISION,
  ADD COLUMN clip_end DOUBLE PRECISION,
  ADD CONSTRAINT exports_clip CHECK (
    (clip_start IS NULL) = (clip_end IS NULL)
    AND (clip_start IS NULL OR (clip_start >= 0 AND clip_end > clip_start))
  ),
  -- What a clip share names (its owner's own copy of their own entry).
  ADD CONSTRAINT exports_id_user_entry UNIQUE (id, user_id, entry_id);
