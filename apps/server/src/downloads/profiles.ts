import { createHash } from "node:crypto";
import type { FormatProfile, VideoCodec } from "@uroboros/contract";
import { sql, type ExpressionBuilder, type Kysely, type Selectable } from "kysely";
import type { Database, FormatProfilesTable } from "../db/schema.ts";

/** The arguments that shape a downloaded file; a download snapshots them when it is queued. */
export interface ProfileArgs {
  format: string;
  mergeFormat: string | null;
  /** Absent in a download queued before profiles had one, which ran with yt-dlp's own order. */
  videoCodec?: VideoCodec | null;
  audioOnly: boolean;
  audioFormat: string | null;
  extraArgs: string[];
}

/**
 * A short hash of the file-shaping arguments: editing any of them changes it, so renditions made
 * with old arguments are never reused for new requests. The seeded profiles' literals in the
 * schema file are this function's output (the test pins them).
 */
export function profileRevision(args: ProfileArgs): string {
  const canonical = JSON.stringify({
    format: args.format,
    mergeFormat: args.mergeFormat,
    audioOnly: args.audioOnly,
    audioFormat: args.audioFormat,
    extraArgs: args.extraArgs,
    // Only when set: a profile without one keeps the revision (and the files) it had before.
    ...(args.videoCodec == null ? {} : { videoCodec: args.videoCodec }),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
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

/** Each codec as yt-dlp's format sort names it. */
const SORT_CODEC: Record<VideoCodec, string> = {
  av1: "av01",
  vp9: "vp9",
  h265: "h265",
  h264: "h264",
};

/**
 * The audio a container takes best: AAC for MP4, which plays it wherever MP4 plays (Opus inside
 * MP4 doesn't), and Opus for WebM, which can't hold AAC.
 */
const CONTAINER_AUDIO: Partial<Record<string, string>> = { mp4: "aac", webm: "opus" };

/**
 * A video profile's format order: yt-dlp's own (`lang,quality,res,fps,hdr:12,vcodec,channels,
 * acodec`, then the rest), restated up to the audio codec with the profile's preferred codecs in
 * it, so the highest resolution still comes first and the codec chooses among copies of one
 * height; a video without it gets the closest codec yt-dlp ranks. Null leaves yt-dlp's order alone.
 */
function formatSort(args: ProfileArgs): string | null {
  const video = args.videoCodec == null ? null : SORT_CODEC[args.videoCodec];
  const audio = args.mergeFormat === null ? undefined : CONTAINER_AUDIO[args.mergeFormat];
  if (video === null && audio === undefined) return null;
  const vcodec = video === null ? "vcodec" : `vcodec:${video}`;
  const acodec = audio === undefined ? "acodec" : `acodec:${audio}`;
  return `--format-sort=lang,quality,res,fps,hdr:12,${vcodec},channels,${acodec}`;
}

/**
 * The yt-dlp format selector and extra arguments a profile runs with: its container and codec
 * order before its own arguments, so a `-S` among those adds to the order rather than replacing it.
 * No SponsorBlock flags: the server asks SponsorBlock itself, so files stay whole
 * (docs/automation.md#sponsorblock).
 */
export function ytdlpArgsFor(args: ProfileArgs): { format: string; extraArgs: string[] } {
  if (args.audioOnly && args.audioFormat !== null) {
    return {
      format: args.format,
      extraArgs: [
        "--extract-audio",
        `--audio-format=${args.audioFormat}`,
        "--write-thumbnail",
        "--convert-thumbnails=jpg",
        ...args.extraArgs,
      ],
    };
  }
  const sort = formatSort(args);
  return {
    format: args.format,
    extraArgs: [
      ...(args.mergeFormat === null ? [] : [`--merge-output-format=${args.mergeFormat}`]),
      ...(sort === null ? [] : [sort]),
      "--write-thumbnail",
      "--convert-thumbnails=jpg",
      ...args.extraArgs,
    ],
  };
}

export type ProfileRow = Selectable<FormatProfilesTable>;

export function argsOf(row: ProfileRow): ProfileArgs & { videoCodec: VideoCodec | null } {
  return {
    format: row.format,
    mergeFormat: row.merge_format,
    videoCodec: row.video_codec,
    audioOnly: row.audio_only,
    audioFormat: row.audio_format,
    extraArgs: row.extra_args,
  };
}

/** The profile as `viewer` sees it: whether it is their default (`defaultId`) is theirs alone. */
export function toProfile(row: ProfileRow, defaultId: string | null): FormatProfile {
  return {
    id: row.id,
    name: row.name,
    ...argsOf(row),
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
