import { randomUUID } from "node:crypto";
import {
  MAX_UNFINISHED_UPLOADS,
  MAX_UPLOAD_PARTS,
  UPLOAD_EXTENSIONS,
  type NewUploadBody,
  type Upload,
} from "@uroboros/contract";
import { sql, type Kysely, type Selectable } from "kysely";
import type { z } from "zod";
import { ApiError } from "../api/errors.ts";
import type { Database } from "../db/schema.ts";
import type { UploadsTable } from "../db/uploadsSchema.ts";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { lockKey } from "../shared/lockKeys.ts";
import type { StorageConfig } from "../storage/config.ts";
import { contentTypeOf } from "../storage/contentType.ts";
import type { MediaStore } from "../storage/store.ts";
import { imageExt } from "./images.ts";
import { dayOf, uploadKey, uploadThumbnailKey } from "./keys.ts";

/** Uploads in progress (docs/uploads.md): their rows, and their bytes in the media store. */

export interface UploadContext extends DownloadContext {
  store: MediaStore;
  storage: StorageConfig;
  /** Every part but the last is this many bytes (8 MiB; tests send smaller ones). */
  partBytes: number;
}

export type UploadRow = Selectable<UploadsTable>;

/** Why an upload failed, for its person. */
export const FAILED_NO_VIDEO = "That file has no video we can read";
export const FAILED_OTHERWISE = "The video could not be processed";

/** The job's options: a few tries, a little apart; the key keeps one job per upload. */
export const UPLOAD_JOB = {
  attempts: 3,
  backoff: { type: "exponential", delayMs: 10_000 },
} as const;
export const uploadJobKey = (id: string) => `upload|${id}`;

/** The file's extension when an upload may have it, else null. */
export function extOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  const ext = dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
  return (UPLOAD_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

const partsOf = (size: number, partBytes: number) => Math.ceil(size / partBytes);

/** 10737418240 → "10 GiB", 1572864 → "1.5 MiB": the cap in words for its person. */
function sizeText(bytes: number): string {
  const units = ["bytes", "KiB", "MiB", "GiB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${shown} ${units[unit] ?? "bytes"}`;
}

/** Part `n`'s size: the part size, or what is left for the last. */
function sizeOfPart(row: UploadRow, n: number): number {
  const size = Number(row.size_bytes);
  return n < partsOf(size, row.part_bytes) ? row.part_bytes : size - row.part_bytes * (n - 1);
}

export function toUpload(row: UploadRow, parts: number[]): Upload {
  return {
    id: row.id,
    filename: row.filename,
    title: row.title,
    size: Number(row.size_bytes),
    partSize: row.part_bytes,
    state: row.state,
    receivedParts: parts,
    error: row.error,
    entryId: row.entry_id,
    createdAt: row.created_at.toISOString(),
  };
}

async function receivedParts(db: Kysely<Database>, id: string): Promise<number[]> {
  const rows = await db
    .selectFrom("upload_parts")
    .select("n")
    .where("upload_id", "=", id)
    .orderBy("n")
    .execute();
  return rows.map((r) => r.n);
}

/** The caller's upload with its received parts; another person's is 404. */
export async function ownUpload(db: Kysely<Database>, userId: string, id: string) {
  const row = await db
    .selectFrom("uploads")
    .selectAll()
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (row === undefined) throw new ApiError("not_found", "no such upload");
  return row;
}

export async function describeUpload(db: Kysely<Database>, row: UploadRow): Promise<Upload> {
  return toUpload(row, await receivedParts(db, row.id));
}

/** The caller's unfinished and failed uploads, oldest first. */
export async function listUploads(db: Kysely<Database>, userId: string): Promise<Upload[]> {
  const rows = await db
    .selectFrom("uploads")
    .selectAll()
    .where("user_id", "=", userId)
    .where("state", "in", ["receiving", "processing", "failed"])
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return Promise.all(rows.map((r) => describeUpload(db, r)));
}

type NewUpload = z.output<typeof NewUploadBody>;

/**
 * Starts an upload: the store's upload begins and the row records it, while the person has fewer
 * than five unfinished (counted under their lock, so uploads started at once can't pass it).
 */
export async function createUpload(
  ctx: UploadContext,
  userId: string,
  body: NewUpload,
): Promise<Upload> {
  const ext = extOf(body.filename);
  if (ext === null) {
    throw new ApiError("bad_request", "uploads must be MP4, M4V, MOV, WebM, MKV or AVI files");
  }
  if (
    body.size > ctx.limits.uploadMaxBytes ||
    partsOf(body.size, ctx.partBytes) > MAX_UPLOAD_PARTS
  ) {
    throw new ApiError(
      "payload_too_large",
      `videos of up to ${sizeText(ctx.limits.uploadMaxBytes)} can be uploaded`,
    );
  }
  const id = randomUUID();
  const mediaId = randomUUID();
  const row = await ctx.db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(${lockKey("UPLD", userId)})`.execute(tx);
    const { n } = await tx
      .selectFrom("uploads")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("user_id", "=", userId)
      .where("state", "in", ["receiving", "processing"])
      .executeTakeFirstOrThrow();
    if (Number(n) >= MAX_UNFINISHED_UPLOADS) {
      throw new ApiError(
        "conflict",
        `finish or cancel an upload first: ${String(MAX_UNFINISHED_UPLOADS)} at most at once`,
      );
    }
    const user = await tx
      .selectFrom("users")
      .select("display_name")
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    const creator = body.creator ?? (user.display_name.trim().slice(0, 100) || "Me");
    const key = uploadKey(ctx.storage, {
      uploadId: id,
      mediaId,
      creator,
      title: body.title,
      ext,
      day: dayOf(new Date()),
    });
    const storeUploadId = await ctx.store.startUpload(key, contentTypeOf(ext));
    try {
      return await tx
        .insertInto("uploads")
        .values({
          id,
          user_id: userId,
          media_id: mediaId,
          filename: body.filename,
          size_bytes: body.size,
          part_bytes: ctx.partBytes,
          ext,
          title: body.title,
          description: body.description ?? null,
          creator,
          tags: body.tags,
          storage_key: key,
          store_upload_id: storeUploadId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      await ctx.store.abortUpload(key, storeUploadId).catch(() => undefined);
      throw err;
    }
  });
  return toUpload(row, []);
}

function receiving(row: UploadRow): void {
  if (row.state !== "receiving") throw new ApiError("conflict", "this upload has all its parts");
}

/** Stores part `n`, which must be exactly its size, then records it. */
export async function putUploadPart(
  ctx: UploadContext,
  userId: string,
  id: string,
  n: number,
  bytes: Uint8Array,
): Promise<void> {
  const row = await ownUpload(ctx.db, userId, id);
  receiving(row);
  const count = partsOf(Number(row.size_bytes), row.part_bytes);
  if (!Number.isInteger(n) || n < 1 || n > count) {
    throw new ApiError("bad_request", `this upload has parts 1 to ${String(count)}`);
  }
  const expected = sizeOfPart(row, n);
  if (bytes.length !== expected) {
    throw new ApiError("bad_request", `part ${String(n)} must be ${String(expected)} bytes`);
  }
  const stored = await ctx.store.putPart(
    row.storage_key,
    row.store_upload_id,
    n,
    (n - 1) * row.part_bytes,
    bytes,
  );
  await ctx.db.transaction().execute(async (tx) => {
    const still = await tx
      .updateTable("uploads")
      .set({ touched_at: sql`now()` })
      .where("id", "=", id)
      .where("state", "=", "receiving")
      .returning("id")
      .executeTakeFirst();
    if (still === undefined) throw new ApiError("conflict", "this upload has all its parts");
    await tx
      .insertInto("upload_parts")
      .values({ upload_id: id, n, size_bytes: bytes.length, ...stored })
      .onConflict((oc) =>
        oc.columns(["upload_id", "n"]).doUpdateSet({
          size_bytes: bytes.length,
          etag: stored.etag,
          checksum: stored.checksum,
        }),
      )
      .execute();
  });
}

/** Stores the upload's thumbnail (JPEG, PNG or WebP by its bytes), replacing one sent before. */
export async function putUploadThumbnail(
  ctx: UploadContext,
  userId: string,
  id: string,
  bytes: Uint8Array,
): Promise<void> {
  const row = await ownUpload(ctx.db, userId, id);
  receiving(row);
  const ext = imageExt(bytes);
  if (ext === null)
    throw new ApiError("bad_request", "a thumbnail must be a JPEG, PNG or WebP image");
  const key = uploadThumbnailKey(ctx.storage, row.storage_key, row.media_id, row.title, ext);
  await ctx.store.putBytes(key, Buffer.from(bytes), contentTypeOf(ext));
  const old = await ctx.db.transaction().execute(async (tx) => {
    const locked = await tx
      .selectFrom("uploads")
      .select(["state", "thumbnail_key"])
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (locked?.state !== "receiving") return undefined;
    await tx.updateTable("uploads").set({ thumbnail_key: key }).where("id", "=", id).execute();
    return locked.thumbnail_key;
  });
  if (old === undefined) {
    await ctx.store.delete(key);
    throw new ApiError("conflict", "this upload has all its parts");
  }
  if (old !== null) await ctx.store.delete(old);
}

/** Every part is in: the upload goes to the `upload` job, in the same transaction. */
export async function completeUpload(
  ctx: UploadContext,
  userId: string,
  id: string,
): Promise<Upload> {
  const row = await ctx.db.transaction().execute(async (tx) => {
    const locked = await tx
      .selectFrom("uploads")
      .selectAll()
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .forUpdate()
      .executeTakeFirst();
    if (locked === undefined) throw new ApiError("not_found", "no such upload");
    receiving(locked);
    const { n, bytes } = await tx
      .selectFrom("upload_parts")
      .select((eb) => [
        eb.fn.countAll<string>().as("n"),
        eb.fn.coalesce(eb.fn.sum<string>("size_bytes"), sql<string>`0`).as("bytes"),
      ])
      .where("upload_id", "=", id)
      .executeTakeFirstOrThrow();
    const count = partsOf(Number(locked.size_bytes), locked.part_bytes);
    if (Number(n) !== count || Number(bytes) !== Number(locked.size_bytes)) {
      throw new ApiError("conflict", `${n} of ${String(count)} parts are in`);
    }
    const updated = await tx
      .updateTable("uploads")
      .set({ state: "processing", touched_at: sql`now()` })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.queues.upload.add(
      "upload",
      { uploadId: id },
      { key: uploadJobKey(id), ...UPLOAD_JOB },
      tx,
    );
    return updated;
  });
  return describeUpload(ctx.db, row);
}

/**
 * Drops an upload's bytes: the store's unfinished upload, its file and its thumbnail. Each step is
 * harmless to repeat, and a failure throws, so callers drop the bytes before the row: what is left
 * stays named, for another try.
 */
export async function dropStorage(store: MediaStore, row: UploadRow): Promise<void> {
  await store.abortUpload(row.storage_key, row.store_upload_id);
  await store.delete(row.storage_key);
  if (row.thumbnail_key !== null) await store.delete(row.thumbnail_key);
}

/**
 * Cancels a receiving upload (its bytes go), or dismisses a failed or done one. One being
 * processed can't be cancelled.
 */
export async function removeUpload(ctx: UploadContext, userId: string, id: string): Promise<void> {
  const row = await ownUpload(ctx.db, userId, id);
  if (row.state === "processing") {
    throw new ApiError("conflict", "this upload is being processed");
  }
  // The bytes go first: a store that fails leaves the row, so a cancel (or the sweep) tries again.
  if (row.state === "receiving") await dropStorage(ctx.store, row);
  else if (row.state === "failed" && row.thumbnail_key !== null) {
    await ctx.store.delete(row.thumbnail_key);
  }
  const gone = await ctx.db
    .deleteFrom("uploads")
    .where("id", "=", id)
    .where("state", "=", row.state)
    .returning("id")
    .executeTakeFirst();
  if (gone === undefined) throw new ApiError("conflict", "this upload just changed");
}

/**
 * Fails an upload being processed, and drops its bytes: only while it is still processing with no
 * entry, under its row's lock, so a run that lost its job never undoes one that filed it. Bytes the
 * store won't drop now (it throws) stay named by the failed row; the sweep drops them with it.
 */
export async function failUpload(
  db: Kysely<Database>,
  store: MediaStore,
  id: string,
  message: string,
): Promise<boolean> {
  const failed = await db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom("uploads")
      .selectAll()
      .where("id", "=", id)
      .forUpdate()
      .executeTakeFirst();
    if (row?.state !== "processing" || row.entry_id !== null) return null;
    await tx
      .updateTable("uploads")
      .set({ state: "failed", error: message, touched_at: sql`now()` })
      .where("id", "=", id)
      .execute();
    await tx.deleteFrom("upload_parts").where("upload_id", "=", id).execute();
    return row;
  });
  if (failed === null) return false;
  await dropStorage(store, failed);
  return true;
}
