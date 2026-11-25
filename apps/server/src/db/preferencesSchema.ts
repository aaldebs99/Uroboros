import type { ColumnType, Generated } from "kysely";

/** `user_preferences`: how a person likes the app; no row means the defaults. Kept apart from schema.ts. */
export interface UserPreferencesTable {
  user_id: string;
  hide_playlist_videos: Generated<boolean>;
  /** Settings › SponsorBlock: the categories shown and skipped, for videos and audio apart. */
  sponsorblock_video_show: Generated<string[]>;
  sponsorblock_video_skip: Generated<string[]>;
  sponsorblock_audio_show: Generated<string[]>;
  sponsorblock_audio_skip: Generated<string[]>;
  /** JSONB: the SponsorBlock colors changed from the extension's (key → `#rrggbb`). */
  sponsorblock_colors: ColumnType<unknown, string | undefined, string>;
}
