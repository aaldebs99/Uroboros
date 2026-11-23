import { createHash } from "node:crypto";
import { SponsorBlockCategory, type FormatProfile } from "@uroboros/contract";
import type { Kysely, Selectable } from "kysely";
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

/** The yt-dlp format selector and extra arguments a profile runs with. */
export function ytdlpArgsFor(args: ProfileArgs): { format: string; extraArgs: string[] } {
  const shape =
    args.audioOnly && args.audioFormat !== null
      ? ["--extract-audio", `--audio-format=${args.audioFormat}`]
      : args.mergeFormat === null
        ? []
        : [`--merge-output-format=${args.mergeFormat}`];
  const cut = [...(args.sponsorblockRemove ?? [])].sort();
  return {
    format: args.format,
    extraArgs: [
      ...shape,
      "--write-thumbnail",
      "--convert-thumbnails=jpg",
      ...(cut.length === 0 ? [] : [`--sponsorblock-remove=${cut.join(",")}`]),
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

export function toProfile(row: ProfileRow): FormatProfile {
  return {
    id: row.id,
    name: row.name,
    ...argsOf(row),
    sponsorblockRemove: row.sponsorblock_remove.filter(isCategory),
    isDefault: row.is_default,
    revision: row.revision,
  };
}

export async function getProfile(
  db: Kysely<Database>,
  id: string,
): Promise<ProfileRow | undefined> {
  return db.selectFrom("format_profiles").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function defaultProfile(db: Kysely<Database>): Promise<ProfileRow | undefined> {
  return db
    .selectFrom("format_profiles")
    .selectAll()
    .where("is_default", "=", true)
    .executeTakeFirst();
}
