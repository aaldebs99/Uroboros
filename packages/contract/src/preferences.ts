import { z } from "@hono/zod-openapi";
import { SPONSORBLOCK_CATEGORIES, SponsorBlockCategory } from "./downloads.ts";

/** Categories, each once and in a stable order, so a saved choice reads back as it was given. */
const Categories = z
  .array(SponsorBlockCategory)
  .max(SPONSORBLOCK_CATEGORIES.length * 2)
  .transform((cs) => [...new Set(cs)].sort());

/**
 * One SponsorBlock choice (docs/automation.md#sponsorblock): the categories whose segments the
 * player draws on the timeline (`show`) and those it jumps over (`skip`). Either may hold a
 * category without the other.
 */
export const SponsorBlockChoice = z
  .object({ show: Categories, skip: Categories })
  .openapi("SponsorBlockChoice");
export type SponsorBlockChoice = z.output<typeof SponsorBlockChoice>;

/** Settings › SponsorBlock: one choice for videos, one for audio files. */
export const SponsorBlockSettings = z
  .object({ video: SponsorBlockChoice, audio: SponsorBlockChoice })
  .openapi("SponsorBlockSettings");
export type SponsorBlockSettings = z.output<typeof SponsorBlockSettings>;

const USUAL: SponsorBlockCategory[] = ["interaction", "selfpromo", "sponsor"];

/** What someone who never chose gets: sponsors, self-promotion and interaction reminders, shown and skipped. */
export const DEFAULT_SPONSORBLOCK: SponsorBlockSettings = {
  video: { show: USUAL, skip: USUAL },
  audio: { show: USUAL, skip: USUAL },
};

/**
 * How a person likes the app, kept on their account so it follows them to every device
 * (`GET /api/me/preferences`); a person who never chose has the defaults.
 */
export const Preferences = z
  .object({
    /** Library › Videos leaves out the videos in any of their playlists (docs/library.md). */
    hidePlaylistVideos: z.boolean(),
    /** Which SponsorBlock segments their player shows and skips. */
    sponsorBlock: SponsorBlockSettings,
  })
  .openapi("Preferences");
export type Preferences = z.output<typeof Preferences>;

/** What a `PATCH /api/me/preferences` changes: only the fields it names. */
export const PreferencesPatch = Preferences.partial().openapi("PreferencesPatch");
export type PreferencesPatch = z.output<typeof PreferencesPatch>;
