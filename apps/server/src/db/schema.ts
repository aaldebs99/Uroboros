import type { ColumnType, Generated } from "kysely";
import type {
  DownloadProgressTable,
  JobLimitsTable,
  JobsTable,
  SigninFailuresTable,
} from "./jobsSchema.ts";
import type {
  PlaybackLiveTable,
  PlaybackSegmentsTable,
  PlaybackSessionsTable,
  RenditionKeyframesTable,
} from "./playbackSchema.ts";
import type { CaptionSegmentsTable } from "./captionsSchema.ts";
import type { ExportsTable } from "./exportsSchema.ts";
import type { NoticesTable } from "./noticesSchema.ts";
import type { GroupMembersTable, GroupsTable } from "./groupsSchema.ts";
import type { NotificationPrefsTable, SharePeopleTable, SharesTable } from "./sharingSchema.ts";
import type { UploadPartsTable, UploadsTable } from "./uploadsSchema.ts";

export type { ShareMode, SharesTable } from "./sharingSchema.ts";

export type { PlaybackSessionEncoder, PlaybackState } from "./playbackSchema.ts";

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
  scopes: ColumnType<("api" | "mcp")[], ("api" | "mcp")[] | undefined, never>;
  read_only: ColumnType<boolean, boolean | undefined, never>;
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
  /** The owner; null for a built-in, everyone's until a person edits or deletes it for themselves. */
  user_id: string | null;
  name: string;
  format: string;
  merge_format: string | null;
  audio_only: Defaulted<boolean>;
  audio_format: string | null;
  extra_args: Defaulted<string[]>;
  sponsorblock_remove: Defaulted<string[]>;
  is_default: Defaulted<boolean>;
  revision: string;
  created_at: Created;
  updated_at: Defaulted<Date | string>;
}

/** `hidden_profiles`: built-ins a person deleted or edited into their own, hidden from them. */
export interface HiddenProfilesTable {
  user_id: string;
  profile_id: string;
}

/** `user_default_profiles`: the profile a person downloads with when they pick none. */
export interface UserDefaultProfilesTable {
  user_id: string;
  profile_id: string;
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
  /** The hover preview clip, once made (docs/library.md "Hover previews"). */
  preview_key: string | null;
  /** When making the preview failed for good. */
  preview_failed_at: Timestamp | null;
  /** Who uploaded it, for an uploaded video (docs/uploads.md). */
  uploaded_by: string | null;
  chapters: ColumnType<unknown, string | undefined, string>;
  created_at: Created;
  updated_at: Defaulted<Date | string>;
}

/** `renditions`: one stored file per media, profile and profile revision. */
export interface RenditionsTable {
  id: Generated<string>;
  media_id: string;
  /** Null once the profile is gone (its owner's account deleted); the reaper sweeps the file. */
  profile_id: string | null;
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
  /** RFC 6381 codec strings (docs/transcoding.md). */
  video_codecs: string | null;
  audio_codecs: string | null;
  /** JSONB: the SponsorBlock segments the player skips (`SkipSegment[]`); `[]` for an audio file. */
  skip_segments: ColumnType<unknown, string | undefined, string>;
  orphaned_at: Timestamp | null;
  created_at: Created;
}

/** `library_entries`: a user's view onto a rendition. */
export interface LibraryEntriesTable {
  id: Generated<string>;
  user_id: string;
  media_id: string;
  rendition_id: string;
  subscription_id: string | null;
  kept: Defaulted<boolean>;
  added_at: Created;
}

/** One listing a subscription follows; `primedAt` is set by that feed's first check. */
export interface FeedJson {
  name: string;
  url: string;
  primedAt?: string | null;
}

/** `subscriptions`: a person following a channel's tabs or a playlist (docs/automation.md). */
export interface SubscriptionsTable {
  id: Generated<string>;
  user_id: string;
  kind: "channel" | "playlist";
  extractor: string;
  source_id: string;
  title: string | null;
  url: string;
  feeds: Json<FeedJson[]>;
  tabs: Json<FeedJson[]>;
  profile_id: string;
  /** Every this many minutes, or null when the subscription checks on a cron. */
  interval_minutes: number | null;
  /** A 5-field cron in `cron_tz`, or null when it checks on an interval. */
  cron: string | null;
  cron_tz: string | null;
  enabled: Defaulted<boolean>;
  /** When the next scheduled check is due; null while paused. */
  next_check_at: Timestamp | null;
  notify: Defaulted<boolean>;
  auto_download: Defaulted<boolean>;
  title_include: string | null;
  title_exclude: string | null;
  min_duration_s: number | null;
  max_duration_s: number | null;
  /** DATE: pg returns it as a Date at local midnight; write "YYYY-MM-DD". */
  uploaded_after: ColumnType<Date | null, string | null | undefined, string | null>;
  exclude_shorts: Defaulted<boolean>;
  exclude_live: Defaulted<boolean>;
  delay_hours: Defaulted<number>;
  backfill: "none" | "newest" | "all";
  backfill_count: number | null;
  keep_last: number | null;
  delete_watched_after_days: number | null;
  last_checked_at: Timestamp | null;
  last_error_kind: string | null;
  last_error_message: string | null;
  failures: Defaulted<number>;
  lease_until: Timestamp | null;
  warning: string | null;
  filters_changed_at: Defaulted<Date | string>;
  created_at: Created;
  updated_at: Defaulted<Date | string>;
}

export type ItemOutcomeValue = "queued" | "new" | "filtered" | "existing" | "waiting";

/** `subscription_items`: what a subscription has seen, and what became of it. */
export interface SubscriptionItemsTable {
  subscription_id: string;
  extractor: string;
  video_id: string;
  title: string | null;
  url: string;
  seen_at: Defaulted<Date | string>;
  outcome: ItemOutcomeValue;
  reason: string | null;
  due_at: Timestamp | null;
  download_id: string | null;
  backfill: Defaulted<boolean>;
}

/** `storage_trash`: keys whose rows are gone and whose files are still to delete. */
export interface StorageTrashTable {
  key: string;
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
  intent: Defaulted<"download" | "subscribe" | "search">;
  state: Defaulted<RequestStateValue>;
  kind: "video" | "playlist" | "channel" | null;
  title: string | null;
  entries: ColumnType<unknown, string | undefined, string>;
  error_kind: string | null;
  error_message: string | null;
  /** A failed probe's last stderr lines from yt-dlp, redacted. */
  stderr_tail: Defaulted<string[]>;
  source_extractor: string | null;
  source_id: string | null;
  /** The entries picked in the preview so far; null until the person changes anything. */
  selected: string[] | null;
  created_at: Created;
  expires_at: Defaulted<Date | string>;
  noticed_at: Timestamp | null;
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
  priority: Defaulted<number>;
  subscription_id: string | null;
  created_at: Created;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
}

/** `subtitles`: one subtitle file of a media. */
export interface SubtitlesTable {
  id: Generated<string>;
  media_id: string;
  lang: string;
  name: string | null;
  automatic: Defaulted<boolean>;
  storage_key: string;
  /** When its captions were read for search; null while that waits. */
  indexed_at: Timestamp | null;
  index_failures: Defaulted<number>;
}

/** `sources`: a playlist someone queued from a preview. */
export interface SourcesTable {
  id: Generated<string>;
  extractor: string;
  source_id: string;
  kind: "playlist";
  title: string | null;
  url: string;
  created_at: Created;
}

export interface UserSourcesTable {
  user_id: string;
  source_id: string;
  queued_at: Created;
}

export interface SourceItemsTable {
  source_id: string;
  extractor: string;
  video_id: string;
  position: number;
}

export interface EntryTagsTable {
  entry_id: string;
  tag: string;
}

export interface WatchProgressTable {
  user_id: string;
  media_id: string;
  position_s: number;
  duration_s: number;
  watched: Defaulted<boolean>;
  watched_at: Timestamp | null;
  updated_at: Defaulted<Date | string>;
}

/** `playlists`: a person's hand-made playlist (docs/sharing.md). */
export interface PlaylistsTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  description: string | null;
  created_at: Created;
  updated_at: Defaulted<Date | string>;
}

export interface PlaylistItemsTable {
  playlist_id: string;
  user_id: string;
  entry_id: string;
  position: number;
  added_at: Created;
}

/** `site_logins`: a person's saved login for one yt-dlp site, the password sealed. */
export interface SiteLoginsTable {
  user_id: string;
  site: string;
  username: string;
  password_sealed: Buffer;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  updated_at: Defaulted<Date>;
}

export interface Database {
  push_devices: PushDevicesTable;
  vapid_keys: VapidKeysTable;
  users: UsersTable;
  auth_sessions: AuthSessionsTable;
  auth_logins: AuthLoginsTable;
  oidc_grants: OidcGrantsTable;
  api_tokens: ApiTokensTable;
  site_logins: SiteLoginsTable;
  push_device_tombstones: PushDeviceTombstonesTable;
  format_profiles: FormatProfilesTable;
  user_default_profiles: UserDefaultProfilesTable;
  hidden_profiles: HiddenProfilesTable;
  media: MediaTable;
  renditions: RenditionsTable;
  library_entries: LibraryEntriesTable;
  download_requests: DownloadRequestsTable;
  downloads: DownloadsTable;
  subtitles: SubtitlesTable;
  caption_segments: CaptionSegmentsTable;
  sources: SourcesTable;
  user_sources: UserSourcesTable;
  source_items: SourceItemsTable;
  entry_tags: EntryTagsTable;
  watch_progress: WatchProgressTable;
  subscriptions: SubscriptionsTable;
  subscription_items: SubscriptionItemsTable;
  storage_trash: StorageTrashTable;
  rendition_keyframes: RenditionKeyframesTable;
  playback_sessions: PlaybackSessionsTable;
  playback_live: PlaybackLiveTable;
  playback_segments: PlaybackSegmentsTable;
  playlists: PlaylistsTable;
  playlist_items: PlaylistItemsTable;
  shares: SharesTable;
  share_people: SharePeopleTable;
  groups: GroupsTable;
  group_members: GroupMembersTable;
  notification_prefs: NotificationPrefsTable;
  jobs: JobsTable;
  job_limits: JobLimitsTable;
  download_progress: DownloadProgressTable;
  signin_failures: SigninFailuresTable;
  uploads: UploadsTable;
  upload_parts: UploadPartsTable;
  exports: ExportsTable;
  notices: NoticesTable;
}
