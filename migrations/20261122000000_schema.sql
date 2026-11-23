-- 20261122000000_schema.sql
-- The whole schema, squashed. Uroboros has no deployed databases yet, so until the first release
-- this one file is edited in place instead of adding migrations; after changing it, reset local
-- databases (docs: CLAUDE.md "Database and tests"). Once a release ships, it becomes forward-only
-- like any migration and changes go into new files.

-- Users and SSO (docs/auth.md). An account is local (username + argon2id password hash) or SSO
-- (OIDC issuer + subject), never both, so "reset password" and "role from IdP groups" are
-- unambiguous. A disabled row may have neither: the legacy placeholder below.
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT CHECK (username = lower(btrim(username)) AND username ~ '^[a-z0-9._-]{1,64}$'),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 128),
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  password_hash TEXT,
  oidc_issuer TEXT,
  oidc_subject TEXT,
  groups JSONB NOT NULL DEFAULT '[]',
  bootstrap BOOLEAN NOT NULL DEFAULT false,
  disabled_at TIMESTAMPTZ,
  -- Set by the claims sync when the provider refuses the user's refresh token; cleared by the
  -- next real sign-in.
  revoked_at TIMESTAMPTZ,
  claims_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT users_one_login_method CHECK (
    (username IS NOT NULL AND password_hash IS NOT NULL
      AND oidc_issuer IS NULL AND oidc_subject IS NULL)
    OR (oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL
      AND username IS NULL AND password_hash IS NULL)
    OR (disabled_at IS NOT NULL
      AND username IS NULL AND password_hash IS NULL
      AND oidc_issuer IS NULL AND oidc_subject IS NULL)
  )
);

CREATE UNIQUE INDEX users_username_key ON users (username) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX users_oidc_key ON users (oidc_issuer, oidc_subject) WHERE oidc_subject IS NOT NULL;
CREATE UNIQUE INDEX users_one_bootstrap ON users (bootstrap) WHERE bootstrap;

-- A signed-in browser. The cookie holds a random 32-byte token; only its SHA-256 is stored.
CREATE TABLE auth_sessions (
  token_hash BYTEA PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at);

-- An OIDC sign-in between the redirect to the provider and its callback (10 minutes).
CREATE TABLE auth_logins (
  state_hash BYTEA PRIMARY KEY,
  binding_hash BYTEA NOT NULL,
  nonce TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_logins_expiry_idx ON auth_logins (expires_at);

-- An SSO user's refresh token, redeemed by the claims sync. Plaintext like Djinn's: it is useless
-- without the client secret, which lives outside the database.
CREATE TABLE oidc_grants (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Personal API tokens (64 hex characters; only the SHA-256 is stored).
CREATE TABLE api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  token_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (user_id, name)
);

-- A push endpoint the user turned off from another device: launch-time sync must not quietly
-- re-register it. Keyed by the SHA-256 of the endpoint URL.
CREATE TABLE push_device_tombstones (
  endpoint_hash BYTEA PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Web Push (docs/push.md). A device is one browser's push subscription, owned by a user.
CREATE TABLE push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
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
