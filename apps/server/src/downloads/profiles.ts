import { createHash } from "node:crypto";
import { SponsorBlockCategory, type FormatProfile } from "@uroboros/contract";
import { sql, type ExpressionBuilder, type Kysely, type Selectable } from "kysely";
import type { Database, FormatProfilesTable } from "../db/schema.ts";

/** The arguments that shape a downloaded file; a download snapshots them when it is queued. */
export interface ProfileArgs {
  format: string;
  mergeFormat: string | null;
  audioOnly: boolean;
  audioFormat: string | null;
  extraArgs: string[];
  /**
   * SponsorBlock categories cut from the file, sorted. Optional: downloads queued before profiles
   * had categories snapshotted none.
   */
  sponsorblockRemove?: string[];
}

/**
 * A short hash of the file-shaping arguments: editing any of them changes it, so renditions made
 * with old arguments are never reused for new requests. The seeded profiles' literals in the
 * schema file are this function's output (the test pins them).
 */
export function profileRevision(args: ProfileArgs): string {
  const cut = [...(args.sponsorblockRemove ?? [])].sort();
  // Only when non-empty, so profiles without categories keep the revisions they had.
  const canonical = JSON.stringify({
    format: args.format,
    mergeFormat: args.mergeFormat,
    audioOnly: args.audioOnly,
    audioFormat: args.audioFormat,
    extraArgs: args.extraArgs,
    ...(cut.length === 0 ? {} : { sponsorblockRemove: cut }),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

/**
 * How a profile's SponsorBlock categories reach yt-dlp. An audio file has them cut out: every audio
 * packet starts a part cleanly. A video keeps them, marked as chapters, and the player skips them:
 * yt-dlp cuts by stream copy, so each kept part would restart at the keyframe before its cut, and
 * the removed segment's last seconds would pile up on one timestamp and play out of sync
 * (docs/automation.md#sponsorblock).
 */
function sponsorBlockArgs(args: ProfileArgs): string[] {
  const categories = [...(args.sponsorblockRemove ?? [])].sort();
  if (categories.length === 0) return [];
  const verb = args.audioOnly ? "remove" : "mark";
  return [`--sponsorblock-${verb}=${categories.join(",")}`];
}

/** Extra arguments that cut a file or trim it, so its times are no longer the video's. */
const TIMELINE_MOVERS = ["--sponsorblock-remove", "--remove-chapters", "--download-sections"];

/**
 * Whether a profile's extra arguments move the file's timeline (docs/automation.md#sponsorblock):
 * SponsorBlock's times would point at the wrong moments in it, so such a file keeps no segments.
 */
export function shiftsTimeline(extraArgs: readonly string[]): boolean {
  return extraArgs.some((a) => TIMELINE_MOVERS.some((f) => a === f || a.startsWith(`${f}=`)));
}

/** The yt-dlp format selector and extra arguments a profile runs with. */
export function ytdlpArgsFor(args: ProfileArgs): { format: string; extraArgs: string[] } {
  const shape =
    args.audioOnly && args.audioFormat !== null
      ? ["--extract-audio", `--audio-format=${args.audioFormat}`]
      : args.mergeFormat === null
        ? []
        : [`--merge-output-format=${args.mergeFormat}`];
  return {
    format: args.format,
    extraArgs: [
      ...shape,
      "--write-thumbnail",
      "--convert-thumbnails=jpg",
      ...sponsorBlockArgs(args),
      ...args.extraArgs,
    ],
  };
}

export type ProfileRow = Selectable<FormatProfilesTable>;

export function argsOf(row: ProfileRow): ProfileArgs {
  return {
    format: row.format,
    mergeFormat: row.merge_format,
    audioOnly: row.audio_only,
    audioFormat: row.audio_format,
    extraArgs: row.extra_args,
    sponsorblockRemove: row.sponsorblock_remove,
  };
}

const isCategory = (c: string): c is SponsorBlockCategory =>
  SponsorBlockCategory.safeParse(c).success;

/** The profile as `viewer` sees it: whether it is their default (`defaultId`) is theirs alone. */
export function toProfile(row: ProfileRow, defaultId: string | null): FormatProfile {
  return {
    id: row.id,
    name: row.name,
    ...argsOf(row),
    sponsorblockRemove: row.sponsorblock_remove.filter(isCategory),
    builtIn: row.user_id === null,
    isDefault: row.id === defaultId,
    revision: row.revision,
  };
}

/** Any profile by id, whoever owns it: for job consumers, whose ids were checked when queued. */
export async function getProfile(
  db: Kysely<Database>,
  id: string,
): Promise<ProfileRow | undefined> {
  return db.selectFrom("format_profiles").selectAll().where("id", "=", id).executeTakeFirst();
}

/**
 * The profiles `userId` sees: their own, and the built-ins they haven't deleted or edited into one
 * of their own (`hidden_profiles`). Someone else's never.
 */
export const seenBy = (userId: string) => (eb: ExpressionBuilder<Database, "format_profiles">) =>
  eb.or([
    eb("format_profiles.user_id", "=", userId),
    eb.and([
      eb("format_profiles.user_id", "is", null),
      eb.not(
        eb.exists(
          eb
            .selectFrom("hidden_profiles as h")
            .select("h.profile_id")
            .whereRef("h.profile_id", "=", "format_profiles.id")
            .where("h.user_id", "=", userId),
        ),
      ),
    ]),
  ]);

/** A profile `userId` may use (`seenBy`); anyone else's, or a built-in they hid, is undefined. */
export async function visibleProfile(
  db: Kysely<Database>,
  userId: string,
  id: string,
): Promise<ProfileRow | undefined> {
  return db
    .selectFrom("format_profiles")
    .selectAll()
    .where("id", "=", id)
    .where(seenBy(userId))
    .executeTakeFirst();
}

/** Every profile `userId` may use: the built-ins they still see, then their own, each by name. */
export async function profilesFor(db: Kysely<Database>, userId: string): Promise<ProfileRow[]> {
  return db
    .selectFrom("format_profiles")
    .selectAll()
    .where(seenBy(userId))
    .orderBy(sql`user_id IS NOT NULL`)
    .orderBy("name")
    .execute();
}

/**
 * What `userId` downloads with when they pick nothing: their own choice (`user_default_profiles`),
 * else the built-in default if they still see it, else their first profile.
 */
export async function defaultProfileFor(
  db: Kysely<Database>,
  userId: string,
): Promise<ProfileRow | undefined> {
  const [chosen, seen] = await Promise.all([
    db
      .selectFrom("user_default_profiles")
      .select("profile_id")
      .where("user_id", "=", userId)
      .executeTakeFirst(),
    profilesFor(db, userId),
  ]);
  return (
    seen.find((p) => p.id === chosen?.profile_id) ?? seen.find((p) => p.is_default) ?? seen.at(0)
  );
}
