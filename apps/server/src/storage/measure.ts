import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { MediaStore } from "./store.ts";

/**
 * Measuring stored files (docs/library.md "Stats"): the code that stores a thumbnail, an
 * `.info.json`, a hover preview or a subtitle records its size, and the leader measures every one
 * that has none, the files stored before sizes were recorded and those the release before stores
 * while both run (it knows no sizes; a trigger forgets a size whose key it changes).
 */

export const MEASURE_EVERY_MS = 60_000;
/** Files measured per pass: a large library is measured over a few minutes. */
export const MEASURE_BATCH = 500;

/** Each kind of file with a size to measure: its table, key column and size column. */
const MEASURED = [
  { table: "media", key: "thumbnail_key", bytes: "thumbnail_bytes" },
  { table: "media", key: "info_key", bytes: "info_bytes" },
  { table: "media", key: "preview_key", bytes: "preview_bytes" },
  { table: "subtitles", key: "storage_key", bytes: "size_bytes" },
] as const;

type Measured = (typeof MEASURED)[number];

/** Measures up to `limit` files of one kind; returns how many. */
async function measureKind(
  db: Kysely<Database>,
  store: MediaStore,
  kind: Measured,
  limit: number,
): Promise<number> {
  const table = sql.table(kind.table);
  const key = sql.ref(kind.key);
  const bytes = sql.ref(kind.bytes);
  const due = await sql<{ id: string; key: string }>`
    SELECT id, ${key} AS key FROM ${table}
    WHERE ${key} IS NOT NULL AND ${bytes} IS NULL
    LIMIT ${limit}`.execute(db);
  for (const row of due.rows) {
    // A file the store no longer has is 0 bytes, so it is not asked about every pass.
    const size = (await store.stat(row.key))?.size ?? 0;
    // Only while the row still holds that file: a key changed meanwhile is measured next pass.
    await sql`
      UPDATE ${table} SET ${bytes} = ${size}
      WHERE id = ${row.id} AND ${key} = ${row.key} AND ${bytes} IS NULL`.execute(db);
  }
  return due.rows.length;
}

/** One pass: measures up to `batch` files without a size; returns how many it measured. */
export async function measureFileSizes(
  db: Kysely<Database>,
  store: MediaStore,
  batch = MEASURE_BATCH,
): Promise<number> {
  let measured = 0;
  for (const kind of MEASURED) {
    if (measured >= batch) break;
    measured += await measureKind(db, store, kind, batch - measured);
  }
  return measured;
}
