import { sql, type Kysely, type Transaction } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { fetchKey } from "../downloads/fetchKey.ts";
import { transcodePrefix } from "../transcode/keys.ts";
import type { MediaStore } from "./store.ts";

/**
 * The reaper (docs/automation.md): files no library entry has referenced for a day are deleted,
 * with media rows nothing uses. Mark and sweep: a rendition is marked when its last entry goes and
 * swept once marked past the grace; the 24 hours are an undo window (queueing the video again links
 * the stored file at once).
 */

export const REAPER_GRACE_MS = 86_400_000;
export const REAPER_EVERY_MS = 900_000;
const TRASH_BATCH = 500;
const ACTIVE = ["queued", "running"] as const;

const olderThan = (ms: number) => sql<Date>`now() - make_interval(secs => ${ms / 1000})`;

/** Marks renditions no entry references, and unmarks those that gained one again. */
export async function markOrphans(
  db: Kysely<Database>,
): Promise<{ marked: number; unmarked: number }> {
  const marked = await sql`
    UPDATE renditions r SET orphaned_at = now()
    WHERE r.orphaned_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM library_entries e WHERE e.rendition_id = r.id)`.execute(db);
  const unmarked = await sql`
    UPDATE renditions r SET orphaned_at = NULL
    WHERE r.orphaned_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM library_entries e WHERE e.rendition_id = r.id)`.execute(db);
  return {
    marked: Number(marked.numAffectedRows ?? 0n),
    unmarked: Number(unmarked.numAffectedRows ?? 0n),
  };
}

const trash = (tx: Transaction<Database>, keys: string[]) =>
  keys.length === 0
    ? Promise.resolve()
    : tx
        .insertInto("storage_trash")
        .values(keys.map((key) => ({ key })))
        .onConflict((oc) => oc.column("key").doNothing())
        .execute()
        .then(() => undefined);

/**
 * Deletes one marked rendition if, under its row lock, nothing needs it: no entry (checked in a new
 * statement, so one committed while we waited for the lock counts) and no active download of its
 * fetch key. Its key goes to the trash in the same transaction.
 */
async function sweepOne(db: Kysely<Database>, id: string): Promise<boolean> {
  return db.transaction().execute(async (tx) => {
    const r = await tx
      .selectFrom("renditions")
      .select(["id", "media_id", "storage_key", "profile_id", "profile_revision"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (r === undefined) return false;
    const used = await tx
      .selectFrom("library_entries")
      .select("id")
      .where("rendition_id", "=", id)
      .executeTakeFirst();
    if (used !== undefined) return false;
    const m = await tx
      .selectFrom("media")
      .select(["extractor", "video_id"])
      .where("id", "=", r.media_id)
      .executeTakeFirstOrThrow();
    const active = await tx
      .selectFrom("downloads")
      .select("id")
      .where("fetch_key", "=", fetchKey(m.extractor, m.video_id, r.profile_id, r.profile_revision))
      .where("state", "in", ACTIVE)
      .executeTakeFirst();
    if (active !== undefined) return false;
    // Its playback copies go with it (cascade); their folders go to the trash now.
    const copies = await tx
      .selectFrom("transcodes")
      .select("id")
      .where("source_rendition_id", "=", id)
      .execute();
    await tx.deleteFrom("renditions").where("id", "=", id).execute();
    await trash(tx, [r.storage_key, ...copies.map((c) => transcodePrefix(c.id))]);
    return true;
  });
}

/** Sweeps renditions marked more than `graceMs` ago; returns how many went. */
export async function sweepRenditions(db: Kysely<Database>, graceMs: number): Promise<number> {
  const due = await db
    .selectFrom("renditions")
    .select("id")
    .where("orphaned_at", "<", olderThan(graceMs))
    .execute();
  let swept = 0;
  for (const { id } of due) if (await sweepOne(db, id)) swept++;
  return swept;
}

/** Deletes one media row with no renditions and no active download, trashing its sidecar keys. */
async function sweepMediaOne(db: Kysely<Database>, id: string): Promise<boolean> {
  return db.transaction().execute(async (tx) => {
    const m = await tx
      .selectFrom("media")
      .select(["id", "extractor", "video_id", "thumbnail_key", "info_key"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (m === undefined) return false;
    const rendition = await tx
      .selectFrom("renditions")
      .select("id")
      .where("media_id", "=", id)
      .executeTakeFirst();
    const active = await tx
      .selectFrom("downloads")
      .select("id")
      .where("extractor", "=", m.extractor)
      .where("video_id", "=", m.video_id)
      .where("state", "in", ACTIVE)
      .executeTakeFirst();
    if (rendition !== undefined || active !== undefined) return false;
    const subs = await tx
      .selectFrom("subtitles")
      .select("storage_key")
      .where("media_id", "=", id)
      .execute();
    await tx.deleteFrom("media").where("id", "=", id).execute();
    const keys = [m.thumbnail_key, m.info_key, ...subs.map((s) => s.storage_key)];
    await trash(
      tx,
      keys.filter((k): k is string => k !== null),
    );
    return true;
  });
}

/** Sweeps media with no renditions left, untouched for `graceMs`; returns how many went. */
export async function sweepMedia(db: Kysely<Database>, graceMs: number): Promise<number> {
  const due = await db
    .selectFrom("media as m")
    .select("m.id")
    .where("m.updated_at", "<", olderThan(graceMs))
    .where((eb) =>
      eb.not(
        eb.exists(
          eb.selectFrom("renditions as r").select("r.id").whereRef("r.media_id", "=", "m.id"),
        ),
      ),
    )
    .execute();
  let swept = 0;
  for (const { id } of due) if (await sweepMediaOne(db, id)) swept++;
  return swept;
}

/** Whether any row still points at `key` (folder-layout keys repeat when a video comes back). */
async function inUse(db: Kysely<Database>, key: string): Promise<boolean> {
  const { rows } = await sql<{ used: boolean }>`
    SELECT EXISTS (SELECT 1 FROM renditions WHERE storage_key = ${key})
        OR EXISTS (SELECT 1 FROM media WHERE thumbnail_key = ${key} OR info_key = ${key})
        OR EXISTS (SELECT 1 FROM subtitles WHERE storage_key = ${key}) AS used`.execute(db);
  return rows[0]?.used ?? false;
}

/**
 * Deletes trashed files, then their trash rows; a failed delete stays for the next pass, and a key
 * some row uses again is only dropped from the trash. Returns how many files went.
 */
export async function emptyTrash(
  db: Kysely<Database>,
  store: MediaStore,
  logger: Logger,
): Promise<number> {
  const keys = await db
    .selectFrom("storage_trash")
    .select("key")
    .orderBy("added_at")
    .limit(TRASH_BATCH)
    .execute();
  let deleted = 0;
  for (const { key } of keys) {
    try {
      if (key.endsWith("/")) {
        // A prefix (a transcode's folder): nothing else is stored under it.
        await store.deletePrefix(key);
        deleted++;
      } else if (!(await inUse(db, key))) {
        await store.delete(key);
        deleted++;
      }
      await db.deleteFrom("storage_trash").where("key", "=", key).execute();
    } catch (err) {
      logger.warn({ err, key }, "deleting a reaped file failed; retrying on the next pass");
    }
  }
  return deleted;
}

/**
 * Deletes playback copies nobody has used for `keepDays` and failed ones older than a day (never a
 * queued or running one), their folders to the trash; returns how many went.
 */
export async function sweepTranscodes(db: Kysely<Database>, keepDays: number): Promise<number> {
  return db.transaction().execute(async (tx) => {
    const gone = await tx
      .deleteFrom("transcodes")
      .where((eb) =>
        eb.or([
          eb.and([
            eb("state", "=", "done"),
            eb("last_used_at", "<", olderThan(keepDays * 86_400_000)),
          ]),
          eb.and([eb("state", "=", "failed"), eb("created_at", "<", olderThan(86_400_000))]),
        ]),
      )
      .returning("id")
      .execute();
    await trash(
      tx,
      gone.map((c) => transcodePrefix(c.id)),
    );
    return gone.length;
  });
}

/** One reaper pass: mark, sweep renditions, media and unused copies, empty the trash. */
export async function reapOnce(
  db: Kysely<Database>,
  store: MediaStore,
  logger: Logger,
  graceMs = REAPER_GRACE_MS,
  keepDays = 30,
) {
  const marks = await markOrphans(db);
  const renditions = await sweepRenditions(db, graceMs);
  const media = await sweepMedia(db, graceMs);
  const copies = await sweepTranscodes(db, keepDays);
  const files = await emptyTrash(db, store, logger);
  if (renditions + media + copies + files > 0) {
    logger.info({ ...marks, renditions, media, copies, files }, "the reaper freed storage");
  }
  return { ...marks, renditions, media, copies, files };
}
