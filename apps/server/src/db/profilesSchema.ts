import type { ColumnType, Generated } from "kysely";

/**
 * The format profiles' tables (docs/downloads.md#format-profiles), kept apart from schema.ts for
 * its length.
 */

type Created = ColumnType<Date, Date | string | undefined, never>;
type Defaulted<T> = ColumnType<T, T | undefined, T>;

export type VideoCodecColumn = "av1" | "vp9" | "h265" | "h264";

/** `format_profiles`: an admin-defined yt-dlp preset (docs/downloads.md). */
export interface FormatProfilesTable {
  id: Generated<string>;
  /** The owner; null for a built-in, everyone's until a person edits or deletes it for themselves. */
  user_id: string | null;
  name: string;
  format: string;
  merge_format: string | null;
  /** The codec preferred among copies of one height; null for none (yt-dlp's order). */
  video_codec: ColumnType<
    VideoCodecColumn | null,
    VideoCodecColumn | null | undefined,
    VideoCodecColumn | null
  >;
  audio_only: Defaulted<boolean>;
  audio_format: string | null;
  extra_args: Defaulted<string[]>;
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
