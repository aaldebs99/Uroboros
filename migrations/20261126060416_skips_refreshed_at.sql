-- 20261126060416_skips_refreshed_at.sql
-- Forward-only: never edit this file once it has been applied anywhere.

-- A file's SponsorBlock segments are refreshed quietly as its owner opens it
-- (docs/automation.md#sponsorblock), at most once an hour per file: skips_refreshed_at is when the
-- last one was asked for, claimed by the request that queues it so two pages opening together queue
-- one. Null until the first. The release before never reads it.
ALTER TABLE renditions ADD COLUMN skips_refreshed_at TIMESTAMPTZ;
