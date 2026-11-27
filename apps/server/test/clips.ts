import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import type { Database } from "../src/db/schema.ts";
import { exportKey } from "../src/exports/store.ts";
import type { MediaStore } from "../src/storage/index.ts";
import { seedEntry } from "./library.ts";

/**
 * A clip copy (docs/sharing.md#clips) of 62–90 s of a fresh 100 s entry of `userId`'s, titled
 * `title`; `done` stores its file ("clip bytes") in `store`.
 */
export async function seedClip(
  db: Kysely<Database>,
  userId: string,
  opts: { title?: string; done?: { store: MediaStore }; entryId?: string } = {},
): Promise<{ exportId: string; entryId: string }> {
  const entryId =
    opts.entryId ??
    (await seedEntry(db, userId, { title: opts.title ?? "Trip", thumbnail: true })).entryId;
  const entry = await db
    .selectFrom("library_entries")
    .select("rendition_id")
    .where("id", "=", entryId)
    .executeTakeFirstOrThrow();
  const row = await db
    .insertInto("exports")
    .values({
      user_id: userId,
      entry_id: entryId,
      rendition_id: entry.rendition_id,
      cuts: JSON.stringify([
        { start: 0, end: 62 },
        { start: 90, end: 100 },
      ]),
      clip_start: 62,
      clip_end: 90,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  if (opts.done !== undefined) {
    const src = join(await mkdtemp(join(tmpdir(), "uroboros-clip-")), "clip.mp4");
    await writeFile(src, "clip bytes");
    await opts.done.store.put(exportKey(row.id, "mp4"), src, "video/mp4");
    await db
      .updateTable("exports")
      .set({
        state: "done",
        progress: 1,
        storage_key: exportKey(row.id, "mp4"),
        size_bytes: 10,
        finished_at: new Date(),
      })
      .where("id", "=", row.id)
      .execute();
  }
  return { exportId: row.id, entryId };
}
