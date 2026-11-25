import type { Generated } from "kysely";

/** `user_preferences`: how a person likes the app; no row means the defaults. Kept apart from schema.ts. */
export interface UserPreferencesTable {
  user_id: string;
  hide_playlist_videos: Generated<boolean>;
}
