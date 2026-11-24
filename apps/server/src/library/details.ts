import type { EntryDetailsBody } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { z } from "zod";
import { ApiError } from "../api/errors.ts";
import type { Database } from "../db/schema.ts";
import { ownEntry } from "../downloads/library.ts";
import type { StorageConfig } from "../storage/config.ts";
import { contentTypeOf } from "../storage/contentType.ts";
import type { MediaStore } from "../storage/store.ts";
import { imageExt } from "../uploads/images.ts";
import { uploadThumbnailKey } from "../uploads/keys.ts";
import { UPLOAD_EXTRACTOR } from "./platform.ts";

/**
 * Editing an uploaded video (docs/uploads.md#editing): its uploader, on their own entry, changes
 * its title, description, creator or thumbnail, for everyone who holds it. A downloaded video is
 * described by its site.
 */

/** The caller's entry of a video they uploaded; 404 for someone else's entry, 403 otherwise. */
async function editableUpload(db: Kysely<Database>, userId: string, entryId: string) {
  const entry = await ownEntry(db, userId, entryId);
  const media = await db
    .selectFrom("media")
    .select(["extractor", "uploaded_by"])
    .where("id", "=", entry.media_id)
    .executeTakeFirstOrThrow();
  if (media.extractor !== UPLOAD_EXTRACTOR) {
    throw new ApiError("forbidden", "a downloaded video is described by its site");
  }
  if (media.uploaded_by !== userId)
    throw new ApiError("forbidden", "only its uploader can edit it");
  return entry;
}

export async function editDetails(
  db: Kysely<Database>,
  userId: string,
  entryId: string,
  body: z.output<typeof EntryDetailsBody>,
): Promise<void> {
  const entry = await editableUpload(db, userId, entryId);
  await db
    .updateTable("media")
    .set({
      title: body.title,
      description: body.description,
      channel: body.creator,
      uploader: body.creator,
      updated_at: new Date(),
    })
    .where("id", "=", entry.media_id)
    .execute();
}

/**
 * Replaces the thumbnail (JPEG, PNG or WebP by its bytes) under a fresh key, so its URL changes;
 * the old file goes to the trash. The media row's lock keeps two replacements from losing a file.
 */
export async function replaceThumbnail(
  db: Kysely<Database>,
  store: MediaStore,
  storage: StorageConfig,
  userId: string,
  entryId: string,
  bytes: Uint8Array,
): Promise<void> {
  const entry = await editableUpload(db, userId, entryId);
  const ext = imageExt(bytes);
  if (ext === null)
    throw new ApiError("bad_request", "a thumbnail must be a JPEG, PNG or WebP image");
  const key = uploadThumbnailKey(
    storage,
    entry.storage_key,
    entry.media_id,
    entry.title ?? entry.video_id,
    ext,
  );
  await store.putBytes(key, Buffer.from(bytes), contentTypeOf(ext));
  await db.transaction().execute(async (tx) => {
    const media = await tx
      .selectFrom("media")
      .select("thumbnail_key")
      .where("id", "=", entry.media_id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    await tx
      .updateTable("media")
      .set({ thumbnail_key: key, updated_at: new Date() })
      .where("id", "=", entry.media_id)
      .execute();
    if (media.thumbnail_key !== null) {
      await tx
        .insertInto("storage_trash")
        .values({ key: media.thumbnail_key })
        .onConflict((oc) => oc.column("key").doNothing())
        .execute();
    }
  });
}
