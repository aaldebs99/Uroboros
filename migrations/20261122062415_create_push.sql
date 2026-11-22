-- 20261122062415_create_push.sql
-- Forward-only: never edit this file once it has been applied anywhere.

-- Web Push (docs/push.md). A device is one browser's push subscription. It is owned by a user id
-- with no foreign key yet: until Users and SSO land, every device belongs to the one local
-- principal (apps/server/src/api/principal.ts), and that step adds the FK in a new migration.
CREATE TABLE push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  -- The push service URL is the subscription's identity: a browser that subscribes again on the
  -- same endpoint updates its row instead of adding one.
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ
);

CREATE INDEX push_devices_user_id_idx ON push_devices (user_id, created_at);

-- The deployment's VAPID key pair when none is configured. One row (id = 1): the first replica
-- to need it inserts a fresh pair with ON CONFLICT DO NOTHING and every replica reads back the
-- winner, so all of them sign with the same key.
CREATE TABLE vapid_keys (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
