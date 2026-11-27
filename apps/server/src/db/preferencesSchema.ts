import type { ColumnType, Generated } from "kysely";

/** `user_preferences`: how a person likes the app; no row means the defaults. Kept apart from schema.ts. */
export interface UserPreferencesTable {
  user_id: string;
  /** Read no more: playlists hide one by one (`hide_from_library`); a later release drops it. */
  hide_playlist_videos: Generated<boolean>;
  /** Settings › SponsorBlock: the categories shown and skipped, for videos and audio apart. */
  sponsorblock_video_show: Generated<string[]>;
  sponsorblock_video_skip: Generated<string[]>;
  sponsorblock_audio_show: Generated<string[]>;
  sponsorblock_audio_skip: Generated<string[]>;
  /** JSONB: the SponsorBlock colors changed from the extension's (key → `#rrggbb`). */
  sponsorblock_colors: ColumnType<unknown, string | undefined, string>;
}

/**
 * `hidden_channels`: the channels a person keeps out of Library › Videos and Audio
 * (docs/library.md#hiding-from-the-library), keyed as a channel key is: the extractor, then the
 * site's channel id (`id`) or, without one, the channel's name (`name`).
 */
export interface HiddenChannelsTable {
  user_id: string;
  extractor: string;
  kind: "id" | "name";
  value: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}
