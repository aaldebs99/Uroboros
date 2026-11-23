import type { Playback } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database, TranscodeEncoder } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { transcodePrefix } from "./keys.ts";
import type { TranscodeRow } from "./playlists.ts";
import { addTranscodeJob } from "./queue.ts";
import { settingsRevision } from "./settings.ts";

/** What the playback routes need: the download context and this deployment's encoder. */
export interface PlaybackContext extends DownloadContext {
  encoder: TranscodeEncoder;
}

/** The rendition behind the caller's entry; another person's entry is 404. */
async function entryRendition(db: Kysely<Database>, userId: string, entryId: string) {
  const row = await db
    .selectFrom("library_entries")
    .select("rendition_id")
    .where("id", "=", entryId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (row === undefined) throw new ApiError("not_found", "no such library entry");
  return row.rendition_id;
}

function findCopy(db: Kysely<Database>, renditionId: string, encoder: TranscodeEncoder) {
  return db
    .selectFrom("transcodes")
    .selectAll()
    .where("source_rendition_id", "=", renditionId)
    .where("settings", "=", settingsRevision(encoder))
    .executeTakeFirst();
}

async function touch(db: Kysely<Database>, id: string): Promise<void> {
  await db
    .updateTable("transcodes")
    .set({ last_used_at: new Date() })
    .where("id", "=", id)
    .execute();
}

export function toPlayback(row: TranscodeRow, entryId: string): Playback {
  return {
    state: row.state,
    mode: row.mode,
    readySegments: row.ready_segments,
    progress: Math.min(1, Math.max(0, row.progress)),
    masterUrl: `/api/library/${entryId}/playback/master.m3u8`,
    error: row.state === "failed" ? (row.error_message ?? "the conversion failed") : null,
  };
}

/** Deletes a failed copy, its files to the trash, so asking again starts afresh. */
async function dropFailed(db: Kysely<Database>, id: string): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await tx.deleteFrom("transcodes").where("id", "=", id).where("state", "=", "failed").execute();
    await tx
      .insertInto("storage_trash")
      .values({ key: transcodePrefix(id) })
      .onConflict((oc) => oc.column("key").doNothing())
      .execute();
  });
}

/**
 * Finds or makes the compatible copy of the caller's entry and queues it unless it is done. Two
 * requests at once make one copy (the unique key); a failed copy is replaced by a new one.
 */
export async function ensurePlayback(
  ctx: PlaybackContext,
  userId: string,
  entryId: string,
): Promise<Playback> {
  const renditionId = await entryRendition(ctx.db, userId, entryId);
  const existing = await findCopy(ctx.db, renditionId, ctx.encoder);
  if (existing?.state === "failed") await dropFailed(ctx.db, existing.id);
  if (existing === undefined || existing.state === "failed") {
    await ctx.db
      .insertInto("transcodes")
      .values({
        source_rendition_id: renditionId,
        encoder: ctx.encoder,
        settings: settingsRevision(ctx.encoder),
      })
      .onConflict((oc) => oc.columns(["source_rendition_id", "settings"]).doNothing())
      .execute();
  }
  const row = await findCopy(ctx.db, renditionId, ctx.encoder);
  if (row === undefined) throw new Error("the copy was not recorded");
  if (row.state !== "done") await addTranscodeJob(ctx.queues.transcode, row.id);
  await touch(ctx.db, row.id);
  return toPlayback(row, entryId);
}

/** The caller's entry's copy as it stands (touched: someone is waiting for it), or null. */
export async function getPlayback(
  ctx: PlaybackContext,
  userId: string,
  entryId: string,
): Promise<Playback | null> {
  const row = await ownCopy(ctx, userId, entryId);
  if (row === undefined) return null;
  await touch(ctx.db, row.id);
  return toPlayback(row, entryId);
}

/** The caller's entry's copy, if any; another person's entry is 404. */
export async function ownCopy(
  ctx: PlaybackContext,
  userId: string,
  entryId: string,
): Promise<TranscodeRow | undefined> {
  const renditionId = await entryRendition(ctx.db, userId, entryId);
  return findCopy(ctx.db, renditionId, ctx.encoder);
}
