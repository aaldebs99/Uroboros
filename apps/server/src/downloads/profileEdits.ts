import type { FormatProfilePatch, NewFormatProfileBody } from "@uroboros/contract";
import { normalizeExtraArgs } from "@uroboros/ytdlp/flags";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import {
  argsOf,
  defaultProfileFor,
  profileRevision,
  profilesFor,
  seenBy,
  visibleProfile,
  type ProfileArgs,
  type ProfileRow,
} from "./profiles.ts";

const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";

/** Video codecs a WebM file can't hold. */
const NOT_IN_WEBM = new Set(["h264", "h265"]);

/** Checks and canonicalizes the arguments; throws `bad_request`. */
function checked(args: ProfileArgs): ProfileArgs {
  if (args.audioOnly !== (args.audioFormat !== null)) {
    throw new ApiError("bad_request", "an audio-only profile needs an audio format, and only it");
  }
  if (args.audioOnly && args.videoCodec != null) {
    throw new ApiError("bad_request", "an audio-only profile has no video codec");
  }
  if (args.mergeFormat === "webm" && args.videoCodec != null && NOT_IN_WEBM.has(args.videoCodec)) {
    throw new ApiError("bad_request", "WebM holds only AV1 or VP9 video");
  }
  try {
    return {
      ...args,
      extraArgs: normalizeExtraArgs(args.extraArgs),
    };
  } catch (err) {
    throw new ApiError("bad_request", err instanceof Error ? err.message : String(err));
  }
}

const codeOf = (err: unknown): string | undefined => (err as { code?: string }).code;

/** Two saves racing past `checkName` meet the unique index. */
function nameTaken(err: unknown): never {
  if (codeOf(err) === UNIQUE_VIOLATION)
    throw new ApiError("conflict", "you have a profile with that name");
  throw err;
}

/** A name any other profile the person sees has (`except` is the one being saved) is taken. */
async function checkName(db: Kysely<Database>, userId: string, name: string, except?: string) {
  const taken = await db
    .selectFrom("format_profiles")
    .select("id")
    .where("name", "=", name)
    .where(seenBy(userId))
    .executeTakeFirst();
  if (taken !== undefined && taken.id !== except) {
    throw new ApiError("conflict", "you have a profile with that name");
  }
}

/** The columns that store a profile's checked arguments, and their revision. */
function argColumns(args: ProfileArgs) {
  return {
    format: args.format,
    merge_format: args.mergeFormat,
    video_codec: args.videoCodec ?? null,
    audio_only: args.audioOnly,
    audio_format: args.audioFormat,
    extra_args: args.extraArgs,
    revision: profileRevision(args),
  };
}

/** Adds a profile of the person's own. */
export async function createProfile(
  db: Kysely<Database>,
  userId: string,
  b: NewFormatProfileBody,
): Promise<ProfileRow> {
  const args = checked({
    format: b.format,
    mergeFormat: b.mergeFormat,
    videoCodec: b.videoCodec,
    audioOnly: b.audioOnly,
    audioFormat: b.audioFormat,
    extraArgs: b.extraArgs,
  });
  await checkName(db, userId, b.name);
  return db
    .insertInto("format_profiles")
    .values({ user_id: userId, name: b.name, ...argColumns(args) })
    .returningAll()
    .executeTakeFirstOrThrow()
    .catch(nameTaken);
}

/**
 * Makes a built-in the person's own, edited (copy-on-write): their copy takes its place for them
 * alone (the built-in is hidden from them), and their subscriptions and default follow it. Everyone
 * else keeps the built-in, and the files they share through it.
 */
async function adoptBuiltIn(
  tx: Transaction<Database>,
  userId: string,
  builtIn: ProfileRow,
  values: { name: string; args: ProfileArgs },
  wasDefault: boolean,
): Promise<ProfileRow> {
  const copy = await tx
    .insertInto("format_profiles")
    .values({ user_id: userId, name: values.name, ...argColumns(values.args) })
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx
    .insertInto("hidden_profiles")
    .values({ user_id: userId, profile_id: builtIn.id })
    .onConflict((oc) => oc.doNothing())
    .execute();
  await tx
    .updateTable("subscriptions")
    .set({ profile_id: copy.id })
    .where("user_id", "=", userId)
    .where("profile_id", "=", builtIn.id)
    .execute();
  if (wasDefault) {
    await tx
      .insertInto("user_default_profiles")
      .values({ user_id: userId, profile_id: copy.id })
      .onConflict((oc) => oc.column("user_id").doUpdateSet({ profile_id: copy.id }))
      .execute();
  }
  return copy;
}

/**
 * Edits a profile the person sees. Their own changes in place; a built-in becomes their own copy
 * (`adoptBuiltIn`), so the answer may carry a new id. Edits apply to downloads queued afterwards.
 */
export async function editProfile(
  db: Kysely<Database>,
  userId: string,
  id: string,
  patch: FormatProfilePatch,
): Promise<ProfileRow> {
  const current = await visibleProfile(db, userId, id);
  if (current === undefined) throw new ApiError("not_found", "no such profile");
  const old = argsOf(current);
  const audioOnly = patch.audioOnly ?? old.audioOnly;
  const args = checked({
    format: patch.format ?? old.format,
    mergeFormat: patch.mergeFormat === undefined ? old.mergeFormat : patch.mergeFormat,
    // Turning a profile audio-only drops its video codec unless the patch names one.
    videoCodec:
      patch.videoCodec !== undefined ? patch.videoCodec : audioOnly ? null : old.videoCodec,
    audioOnly,
    audioFormat: patch.audioFormat === undefined ? old.audioFormat : patch.audioFormat,
    extraArgs: patch.extraArgs ?? old.extraArgs,
  });
  const name = patch.name ?? current.name;
  await checkName(db, userId, name, id);
  if (current.user_id === null) {
    const wasDefault = (await defaultProfileFor(db, userId))?.id === id;
    return db
      .transaction()
      .execute((tx) => adoptBuiltIn(tx, userId, current, { name, args }, wasDefault))
      .catch(nameTaken);
  }
  return db
    .updateTable("format_profiles")
    .set({ name, ...argColumns(args), updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow()
    .catch(nameTaken);
}

/** Whether downloads, subscriptions or a library's files still use one of the person's own. */
async function inUse(db: Kysely<Database>, id: string): Promise<boolean> {
  const used = await db
    .selectFrom("format_profiles as p")
    .select("p.id")
    .where("p.id", "=", id)
    .where((eb) =>
      eb.or([
        eb.exists(eb.selectFrom("downloads").select("id").where("profile_id", "=", id)),
        eb.exists(eb.selectFrom("subscriptions").select("id").where("profile_id", "=", id)),
        eb.exists(
          eb
            .selectFrom("renditions as r")
            .innerJoin("library_entries as e", "e.rendition_id", "r.id")
            .select("r.id")
            .where("r.profile_id", "=", id),
        ),
      ]),
    )
    .executeTakeFirst();
  return used !== undefined;
}

/** Hides a built-in from the person alone; refused while their subscriptions follow it. */
async function hideBuiltIn(db: Kysely<Database>, userId: string, id: string): Promise<void> {
  const following = await db
    .selectFrom("subscriptions")
    .select("id")
    .where("user_id", "=", userId)
    .where("profile_id", "=", id)
    .executeTakeFirst();
  if (following !== undefined) throw new ApiError("conflict", "your subscriptions use it");
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("hidden_profiles")
      .values({ user_id: userId, profile_id: id })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await tx
      .deleteFrom("user_default_profiles")
      .where("user_id", "=", userId)
      .where("profile_id", "=", id)
      .execute();
  });
}

/**
 * Deletes a profile the person sees: their own once nothing uses it, or a built-in for them alone
 * (hidden; everyone else keeps it). The last profile someone has stays, so a download always has
 * one to use.
 */
export async function removeProfile(
  db: Kysely<Database>,
  userId: string,
  id: string,
): Promise<void> {
  const current = await visibleProfile(db, userId, id);
  if (current === undefined) throw new ApiError("not_found", "no such profile");
  if ((await profilesFor(db, userId)).length <= 1) {
    throw new ApiError("conflict", "keep at least one profile to download with");
  }
  if (current.user_id === null) {
    await hideBuiltIn(db, userId, id);
    return;
  }
  if (await inUse(db, id)) {
    throw new ApiError("conflict", "downloads, subscriptions or files in your library use it");
  }
  try {
    // A file nobody has any more keeps no profile (renditions SET NULL); the reaper sweeps it.
    await db.deleteFrom("format_profiles").where("id", "=", id).execute();
  } catch (err) {
    if (codeOf(err) === FK_VIOLATION) throw new ApiError("conflict", "downloads use it");
    throw err;
  }
}

/** Makes a profile the person sees the one they download with when they pick none. */
export async function chooseDefault(
  db: Kysely<Database>,
  userId: string,
  profileId: string,
): Promise<void> {
  if ((await visibleProfile(db, userId, profileId)) === undefined) {
    throw new ApiError("not_found", "no such profile");
  }
  await db
    .insertInto("user_default_profiles")
    .values({ user_id: userId, profile_id: profileId })
    .onConflict((oc) => oc.column("user_id").doUpdateSet({ profile_id: profileId }))
    .execute();
}
