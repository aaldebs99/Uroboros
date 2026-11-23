import type { ColumnType, Generated } from "kysely";

/** A `TIMESTAMPTZ`: read as a `Date`, written as a `Date` or an ISO string. */
type Timestamp = ColumnType<Date, Date | string, Date | string>;

/** `push_devices`: one browser's Web Push subscription (docs/push.md). */
export interface PushDevicesTable {
  id: Generated<string>;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  last_success_at: Timestamp | null;
  failed_at: Timestamp | null;
}

/** `vapid_keys`: the single generated VAPID pair (id is always 1). */
export interface VapidKeysTable {
  id: number;
  public_key: string;
  private_key: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

/** `users`: an account, local (username + password hash) or SSO (OIDC issuer + subject). */
export interface UsersTable {
  id: Generated<string>;
  username: string | null;
  display_name: string;
  email: string | null;
  role: "admin" | "member";
  password_hash: string | null;
  oidc_issuer: string | null;
  oidc_subject: string | null;
  groups: ColumnType<string[], string[] | string | undefined, string[] | string>;
  bootstrap: ColumnType<boolean, boolean | undefined, boolean>;
  disabled_at: Timestamp | null;
  revoked_at: Timestamp | null;
  claims_synced_at: Timestamp | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  last_login_at: Timestamp | null;
}

/** `auth_sessions`: a signed-in browser; only the token's SHA-256 is stored. */
export interface AuthSessionsTable {
  token_hash: Buffer;
  user_id: string;
  csrf: string;
  user_agent: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  last_seen_at: ColumnType<Date, Date | string | undefined, Date | string>;
  expires_at: Timestamp;
}

/** `auth_logins`: an OIDC sign-in waiting for its callback. */
export interface AuthLoginsTable {
  state_hash: Buffer;
  binding_hash: Buffer;
  nonce: string;
  pkce_verifier: string;
  return_to: string;
  expires_at: Timestamp;
}

/** `oidc_grants`: an SSO user's refresh token for the claims sync. */
export interface OidcGrantsTable {
  user_id: string;
  refresh_token: string;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/** `api_tokens`: a personal API token; only its SHA-256 is stored. */
export interface ApiTokensTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  token_hash: Buffer;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  last_used_at: Timestamp | null;
}

/** `push_device_tombstones`: an endpoint turned off from another device. */
export interface PushDeviceTombstonesTable {
  endpoint_hash: Buffer;
  user_id: string;
  deleted_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

/** Kysely table map: one entry per table the migrations create. */
export interface Database {
  push_devices: PushDevicesTable;
  vapid_keys: VapidKeysTable;
  users: UsersTable;
  auth_sessions: AuthSessionsTable;
  auth_logins: AuthLoginsTable;
  oidc_grants: OidcGrantsTable;
  api_tokens: ApiTokensTable;
  push_device_tombstones: PushDeviceTombstonesTable;
}
