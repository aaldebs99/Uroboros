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

/** `value`, frozen all the way down: a shared default nobody may change in place. */
function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) frozen(v);
    Object.freeze(value);
  }
  return value;
}

const USUAL: SponsorBlockCategory[] = ["interaction", "selfpromo", "sponsor"];

/** What someone who never chose gets: sponsors, self-promotion and interaction reminders, shown and skipped. */
export const DEFAULT_SPONSORBLOCK: SponsorBlockSettings = frozen({
  video: { show: USUAL, skip: USUAL },
  audio: { show: USUAL, skip: USUAL },
});

/** What a colour is chosen for: each segment category, and the highlight (`poi_highlight`). */
export const SPONSORBLOCK_COLOR_KEYS = [...SPONSORBLOCK_CATEGORIES, "poi_highlight"] as const;
export type SponsorBlockColorKey = (typeof SPONSORBLOCK_COLOR_KEYS)[number];

/** A colour as `#rrggbb`, kept lower-case. */
const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "a colour is #rrggbb")
  .transform((c) => c.toLowerCase())
  .openapi({ example: "#00d400" });

/**
 * The colours a person's player draws SponsorBlock's segments and highlight in on the timeline
 * (Settings › SponsorBlock), one per category and one for the highlight, videos and audio alike.
 */
export const SponsorBlockColors = z
  .object(
    Object.fromEntries(SPONSORBLOCK_COLOR_KEYS.map((k) => [k, HexColor])) as Record<
      SponsorBlockColorKey,
      typeof HexColor
    >,
  )
  .openapi("SponsorBlockColors");
export type SponsorBlockColors = z.output<typeof SponsorBlockColors>;

/** The SponsorBlock browser extension's own colours, which a person starts with. */
export const DEFAULT_SPONSORBLOCK_COLORS: SponsorBlockColors = frozen({
  sponsor: "#00d400",
  intro: "#00ffff",
  outro: "#0202ed",
  selfpromo: "#ffff00",
  preview: "#008fd6",
  hook: "#395699",
  filler: "#7300ff",
  interaction: "#cc00ff",
  music_offtopic: "#ff9900",
  poi_highlight: "#ff1684",
});

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
    /** The colours their player draws SponsorBlock's segments and highlight in. */
    sponsorBlockColors: SponsorBlockColors,
  })
  .openapi("Preferences");
export type Preferences = z.output<typeof Preferences>;

/** What a `PATCH /api/me/preferences` changes: only the fields it names. */
export const PreferencesPatch = Preferences.partial().openapi("PreferencesPatch");
export type PreferencesPatch = z.output<typeof PreferencesPatch>;
