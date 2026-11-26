-- 20261126040250_announce_subscription_videos.sql
-- Forward-only: never edit this file once it has been applied anywhere.


-- A subscription's new video is announced once it is in the library (docs/automation.md
-- "Notifications"): "New from <subscription>", opening the video. A check that queues a new video
-- (never a backfill, never one picked by hand) sets announce; the first to see the download done
-- (or failed for good) clears it and sends the notice, so it goes out once. The release before
-- never sets it, and announces at the check as it always did.
ALTER TABLE downloads ADD COLUMN announce BOOLEAN NOT NULL DEFAULT false;
