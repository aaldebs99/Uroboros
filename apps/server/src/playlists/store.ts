import {
  PLAYLIST_MAX_ITEMS,
  type NewPlaylistBody,
  type PlaylistDetail,
  type PlaylistPatch,
} from "@uroboros/contract";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { getPlaylist } from "./listing.ts";

type Tx = Transaction<Database>;

/**
 * The caller's manual playlist, locked for the rest of the transaction so two edits never
 * interleave their positions. One of their YouTube playlists is 409; anyone else's is 404.
 */
async function lockManual(tx: Tx, userId: string, id: string): Promise<void> {
  const row = await tx
    .selectFrom("playlists")
    .select("id")
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .forUpdate()
    .executeTakeFirst();
  if (row !== undefined) return;
  const youtube = await tx
    .selectFrom("user_sources")
    .select("source_id")
    .where("source_id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (youtube !== undefined) throw new ApiError("conflict", "a YouTube playlist cannot be changed");
  throw new ApiError("not_found", "no such playlist");
}

/** Every id is one of the caller's entries, and none appears twice. */
async function checkEntries(tx: Tx, userId: string, ids: readonly string[]): Promise<void> {
  if (new Set(ids).size !== ids.length) {
    throw new ApiError("bad_request", "an entry appears more than once");
  }
  if (ids.length === 0) return;
  const found = await tx
    .selectFrom("library_entries")
    .select(sql<string>`count(*)`.as("n"))
    .where("id", "in", ids)
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();
  if (Number(found.n) !== ids.length) {
    throw new ApiError("bad_request", "every entry must be in your library");
  }
}

const touch = (tx: Tx, id: string) =>
  tx.updateTable("playlists").set({ updated_at: new Date() }).where("id", "=", id).execute();

/** Replaces the items with `ids`, positions 0 to n-1. */
async function writeItems(tx: Tx, userId: string, id: string, ids: readonly string[]) {
  await tx.deleteFrom("playlist_items").where("playlist_id", "=", id).execute();
  if (ids.length === 0) return;
  await tx
    .insertInto("playlist_items")
    .values(
      ids.map((entry_id, position) => ({ playlist_id: id, user_id: userId, entry_id, position })),
    )
    .execute();
}

async function currentIds(tx: Tx, id: string): Promise<string[]> {
  const rows = await tx
    .selectFrom("playlist_items")
    .select("entry_id")
    .where("playlist_id", "=", id)
    .orderBy("position")
    .execute();
  return rows.map((r) => r.entry_id);
}

export async function createPlaylist(
  db: Kysely<Database>,
  userId: string,
  body: NewPlaylistBody,
): Promise<PlaylistDetail> {
  const id = await db.transaction().execute(async (tx) => {
    const ids = body.entryIds ?? [];
    await checkEntries(tx, userId, ids);
    const row = await tx
      .insertInto("playlists")
      .values({ user_id: userId, name: body.name, description: body.description ?? null })
      .returning("id")
      .executeTakeFirstOrThrow();
    await writeItems(tx, userId, row.id, ids);
    return row.id;
  });
  return getPlaylist(db, userId, id);
}

export async function updatePlaylist(
  db: Kysely<Database>,
  userId: string,
  id: string,
  patch: PlaylistPatch,
): Promise<PlaylistDetail> {
  await db.transaction().execute(async (tx) => {
    await lockManual(tx, userId, id);
    await tx
      .updateTable("playlists")
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .execute();
  });
  return getPlaylist(db, userId, id);
}

export async function deletePlaylist(db: Kysely<Database>, userId: string, id: string) {
  await db.transaction().execute(async (tx) => {
    await lockManual(tx, userId, id);
    await tx.deleteFrom("playlists").where("id", "=", id).execute();
  });
}

/** Adds entries at the end, skipping ones already in it. */
export async function appendItems(
  db: Kysely<Database>,
  userId: string,
  id: string,
  ids: readonly string[],
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lockManual(tx, userId, id);
    await checkEntries(tx, userId, ids);
    const current = await currentIds(tx, id);
    const have = new Set(current);
    const added = ids.filter((e) => !have.has(e));
    if (added.length === 0) return;
    if (current.length + added.length > PLAYLIST_MAX_ITEMS) {
      throw new ApiError(
        "bad_request",
        `a playlist holds at most ${String(PLAYLIST_MAX_ITEMS)} videos`,
      );
    }
    await writeItems(tx, userId, id, [...current, ...added]);
    await touch(tx, id);
  });
}

/** Sets the whole order: entries left out leave the playlist. */
export async function replaceItems(
  db: Kysely<Database>,
  userId: string,
  id: string,
  ids: readonly string[],
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lockManual(tx, userId, id);
    await checkEntries(tx, userId, ids);
    await writeItems(tx, userId, id, ids);
    await touch(tx, id);
  });
}

/** Moves one entry to `position` (clamped to the end), shifting the others. */
export async function moveItem(
  db: Kysely<Database>,
  userId: string,
  id: string,
  entryId: string,
  position: number,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lockManual(tx, userId, id);
    const current = await currentIds(tx, id);
    const from = current.indexOf(entryId);
    if (from === -1) throw new ApiError("not_found", "that video is not in this playlist");
    current.splice(from, 1);
    current.splice(Math.min(position, current.length), 0, entryId);
    await writeItems(tx, userId, id, current);
    await touch(tx, id);
  });
}

export async function removeItem(
  db: Kysely<Database>,
  userId: string,
  id: string,
  entryId: string,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lockManual(tx, userId, id);
    const current = await currentIds(tx, id);
    if (!current.includes(entryId)) {
      throw new ApiError("not_found", "that video is not in this playlist");
    }
    await writeItems(
      tx,
      userId,
      id,
      current.filter((e) => e !== entryId),
    );
    await touch(tx, id);
  });
}

/** A new manual playlist of the caller's entries in this order (Save as my playlist). */
export async function copyEntries(
  db: Kysely<Database>,
  userId: string,
  name: string | null,
  entryIds: readonly string[],
): Promise<PlaylistDetail> {
  const trimmed = (name ?? "").trim().slice(0, 100).trim();
  return createPlaylist(db, userId, {
    name: trimmed === "" ? "Untitled playlist" : trimmed,
    entryIds: entryIds.slice(0, PLAYLIST_MAX_ITEMS),
  });
}
