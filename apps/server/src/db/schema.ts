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
type Created = ColumnType<Date, Date | string | undefined, never>;
type Defaulted<T> = ColumnType<T, T | undefined, T>;
/** A JSONB column: read parsed, written as JSON text. */
type Json<T> = ColumnType<T, string, string>;

/** `format_profiles`: an admin-defined yt-dlp preset (docs/downloads.md). */
export interface FormatProfilesTable {
  id: Generated<string>;
  name: string;
  format: string;
  merge_format: string | null;
  audio_only: Defaulted<boolean>;
  audio_format: string | null;
  extra_args: Defaulted<string[]>;
  is_default: Defaulted<boolean>;
  revision: string;
  created_at: Created;
  updated_at: Defaulted<Date | string>;
}

/** `media`: one video, by extractor and id, shared by every user. */
export interface MediaTable {
  id: Generated<string>;
  extractor: string;
  video_id: string;
  title: string | null;
  channel: string | null;
  channel_id: string | null;
  uploader: string | null;
  upload_date: string | null;
  duration: number | null;
  description: string | null;
  webpage_url: string | null;
  thumbnail_key: string | null;
  info_key: string | null;
  created_at: Created;
  updated_at: Defaulted<Date | string>;
}

/** `renditions`: one stored file per media, profile and profile revision. */
export interface RenditionsTable {
  id: Generated<string>;
  media_id: string;
  profile_id: string;
  profile_revision: string;
  storage_key: string;
  /** BIGINT: pg returns it as a string. */
  size_bytes: ColumnType<string, number | string, number | string>;
  container: string | null;
  video_codec: string | null;
  audio_codec: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  created_at: Created;
}

/** `library_entries`: a user's view onto a rendition. */
export interface LibraryEntriesTable {
  id: Generated<string>;
  user_id: string;
  media_id: string;
  rendition_id: string;
  added_at: Created;
}

export type RequestStateValue = "probing" | "choosing" | "queued" | "failed";
export type DownloadStateValue = "queued" | "running" | "done" | "failed" | "cancelled";

/** `download_requests`: a pasted link, probed, then previewed when it is a playlist or channel. */
export interface DownloadRequestsTable {
  id: Generated<string>;
  user_id: string;
  url: string;
  profile_id: string;
  state: Defaulted<RequestStateValue>;
  kind: "video" | "playlist" | "channel" | null;
  title: string | null;
  entries: ColumnType<unknown, string | undefined, string>;
  error_kind: string | null;
  error_message: string | null;
  created_at: Created;
  expires_at: Defaulted<Date | string>;
}

/** `downloads`: one video a user asked for, waiting on a shared fetch. */
export interface DownloadsTable {
  id: Generated<string>;
  user_id: string;
  request_id: string | null;
  profile_id: string;
  profile_revision: string;
  args: Json<unknown>;
  extractor: string;
  video_id: string;
  url: string;
  title: string | null;
  fetch_key: string;
  state: Defaulted<DownloadStateValue>;
  dispatched_at: Timestamp | null;
  rendition_id: string | null;
  error_kind: string | null;
  error_message: string | null;
  stderr_tail: Defaulted<string[]>;
  attempts: Defaulted<number>;
  created_at: Created;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
}

export interface Database {
  push_devices: PushDevicesTable;
  vapid_keys: VapidKeysTable;
  users: UsersTable;
  auth_sessions: AuthSessionsTable;
  auth_logins: AuthLoginsTable;
  oidc_grants: OidcGrantsTable;
  api_tokens: ApiTokensTable;
  push_device_tombstones: PushDeviceTombstonesTable;
  format_profiles: FormatProfilesTable;
  media: MediaTable;
  renditions: RenditionsTable;
  library_entries: LibraryEntriesTable;
  download_requests: DownloadRequestsTable;
  downloads: DownloadsTable;
}
