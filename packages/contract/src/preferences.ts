import { z } from "@hono/zod-openapi";

/**
 * How a person likes the app, kept on their account so it follows them to every device
 * (`GET /api/me/preferences`); a person who never chose has the defaults.
 */
export const Preferences = z
  .object({
    /** Library › Videos leaves out the videos in any of their playlists (docs/library.md). */
    hidePlaylistVideos: z.boolean(),
  })
  .openapi("Preferences");
export type Preferences = z.infer<typeof Preferences>;

/** What a `PATCH /api/me/preferences` changes: only the fields it names. */
export const PreferencesPatch = Preferences.partial().openapi("PreferencesPatch");
export type PreferencesPatch = z.infer<typeof PreferencesPatch>;
