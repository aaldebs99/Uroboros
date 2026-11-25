import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  DEFAULT_SPONSORBLOCK,
  DEFAULT_SPONSORBLOCK_COLORS,
  Preferences,
  PreferencesPatch,
  SPONSORBLOCK_COLOR_KEYS,
  SponsorBlockCategory,
  SponsorBlockColors,
  type SponsorBlockSettings,
} from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { currentPrincipal } from "../api/principal.ts";

const SPONSORBLOCK_COLUMNS = [
  "sponsorblock_video_show",
  "sponsorblock_video_skip",
  "sponsorblock_audio_show",
  "sponsorblock_audio_skip",
] as const;

type SponsorBlockRow = Record<(typeof SPONSORBLOCK_COLUMNS)[number], string[]>;

const known = (cs: readonly string[]): SponsorBlockCategory[] =>
  cs.filter((c): c is SponsorBlockCategory => SponsorBlockCategory.safeParse(c).success).sort();

function sponsorBlockFrom(row: SponsorBlockRow | undefined): SponsorBlockSettings {
  if (row === undefined) return DEFAULT_SPONSORBLOCK;
  return {
    video: { show: known(row.sponsorblock_video_show), skip: known(row.sponsorblock_video_skip) },
    audio: { show: known(row.sponsorblock_audio_show), skip: known(row.sponsorblock_audio_skip) },
  };
}

/**
 * The colors a person keeps: SponsorBlock's, with each stored one that is still a color for a
 * key the app knows in its place.
 */
function colorsFrom(stored: unknown): SponsorBlockColors {
  const kept: Record<string, unknown> =
    typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const colors = { ...DEFAULT_SPONSORBLOCK_COLORS };
  for (const key of SPONSORBLOCK_COLOR_KEYS) {
    const one = SponsorBlockColors.shape[key].safeParse(kept[key]);
    if (one.success) colors[key] = one.data;
  }
  return colors;
}

/** The colors that differ from SponsorBlock's, as stored: SponsorBlock's own keep nothing. */
function changedColors(colors: SponsorBlockColors): Partial<SponsorBlockColors> {
  return Object.fromEntries(
    SPONSORBLOCK_COLOR_KEYS.filter((k) => colors[k] !== DEFAULT_SPONSORBLOCK_COLORS[k]).map((k) => [
      k,
      colors[k],
    ]),
  );
}

/** A person's preferences (docs/library.md "Hide playlist videos"); no row means the defaults. */
export async function getPreferences(db: Kysely<Database>, userId: string): Promise<Preferences> {
  const row = await db
    .selectFrom("user_preferences")
    .select(["hide_playlist_videos", "sponsorblock_colors", ...SPONSORBLOCK_COLUMNS])
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return {
    hidePlaylistVideos: row?.hide_playlist_videos ?? false,
    sponsorBlock: sponsorBlockFrom(row),
    sponsorBlockColors: colorsFrom(row?.sponsorblock_colors),
  };
}

/**
 * A person's SponsorBlock choices alone (docs/automation.md#sponsorblock), for the routes that hand
 * out segments; no row means the defaults.
 */
export async function sponsorBlockOf(
  db: Kysely<Database>,
  userId: string,
): Promise<SponsorBlockSettings> {
  const row = await db
    .selectFrom("user_preferences")
    .select(SPONSORBLOCK_COLUMNS)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return sponsorBlockFrom(row);
}

/** Saves what `patch` names, leaving the rest as they were; answers them all. */
export async function updatePreferences(
  db: Kysely<Database>,
  userId: string,
  patch: PreferencesPatch,
): Promise<Preferences> {
  const sb = patch.sponsorBlock;
  const colors = patch.sponsorBlockColors;
  const columns = {
    ...(patch.hidePlaylistVideos === undefined
      ? {}
      : { hide_playlist_videos: patch.hidePlaylistVideos }),
    ...(sb === undefined
      ? {}
      : {
          sponsorblock_video_show: sb.video.show,
          sponsorblock_video_skip: sb.video.skip,
          sponsorblock_audio_show: sb.audio.show,
          sponsorblock_audio_skip: sb.audio.skip,
        }),
    ...(colors === undefined ? {} : { sponsorblock_colors: JSON.stringify(changedColors(colors)) }),
  };
  if (Object.keys(columns).length > 0) {
    await db
      .insertInto("user_preferences")
      .values({ user_id: userId, ...columns })
      .onConflict((oc) => oc.column("user_id").doUpdateSet(columns))
      .execute();
  }
  return getPreferences(db, userId);
}

const answer = {
  description: "The caller's preferences, every one",
  content: { "application/json": { schema: Preferences } },
};

const getRoute = createRoute({
  method: "get",
  path: "/api/me/preferences",
  tags: ["library"],
  summary: "How the caller likes the app (the defaults until they choose)",
  responses: { 200: answer },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/api/me/preferences",
  tags: ["library"],
  summary: "Change some of the caller's preferences; the others stay",
  request: {
    body: { required: true, content: { "application/json": { schema: PreferencesPatch } } },
  },
  responses: { 200: answer },
});

/** `GET`/`PATCH /api/me/preferences`. */
export function registerPreferenceRoutes(app: OpenAPIHono, db: Kysely<Database>): void {
  app.openapi(getRoute, async (c) =>
    c.json(await getPreferences(db, currentPrincipal(c).userId), 200),
  );
  app.openapi(patchRoute, async (c) =>
    c.json(await updatePreferences(db, currentPrincipal(c).userId, c.req.valid("json")), 200),
  );
}
