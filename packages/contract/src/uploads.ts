import { z } from "@hono/zod-openapi";
import { MAX_TAGS, Tag } from "./library.ts";

/**
 * Uploads (docs/uploads.md): a person's own video, sent from the browser in parts straight into
 * the media store, then filed in their library by a job.
 */

const Id = z.uuid();

/** Every part of an upload but the last is exactly this many bytes. */
export const UPLOAD_PART_BYTES = 8 * 1024 * 1024;
/** The most parts one upload may have (S3's own limit). */
export const MAX_UPLOAD_PARTS = 10_000;
/** The largest thumbnail an upload (or an edit) may carry. */
export const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;
/** Uploads a person may have receiving or processing at once. */
export const MAX_UNFINISHED_UPLOADS = 5;
/** The file extensions an upload may have; the job then checks there is a video inside. */
export const UPLOAD_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "mkv", "avi"] as const;
/** The thumbnail images taken (checked by their bytes, not only this type). */
export const THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const UPLOAD_TITLE_CHARS = 200;
export const UPLOAD_CREATOR_CHARS = 100;
export const UPLOAD_DESCRIPTION_CHARS = 5000;

const Title = z.string().trim().min(1).max(UPLOAD_TITLE_CHARS);
const Creator = z.string().trim().min(1).max(UPLOAD_CREATOR_CHARS);
/** Blank is none. */
const Description = z
  .string()
  .trim()
  .max(UPLOAD_DESCRIPTION_CHARS)
  .transform((d) => (d === "" ? null : d));

export const NewUploadBody = z
  .object({
    /** The file's own name, for its extension and to match a resumed upload's file. */
    filename: z.string().min(1).max(255),
    size: z.number().int().positive(),
    title: Title,
    description: Description.nullable().optional(),
    /** Who the video is by; the uploader's display name when left out. */
    creator: Creator.optional(),
    tags: z
      .array(Tag)
      .max(MAX_TAGS)
      .default([])
      .transform((tags) => [...new Set(tags)]),
  })
  .openapi("NewUploadBody");
export type NewUploadBody = z.input<typeof NewUploadBody>;

export const UploadState = z
  .enum(["receiving", "processing", "done", "failed"])
  .openapi("UploadState");
export type UploadState = z.infer<typeof UploadState>;

export const Upload = z
  .object({
    id: Id,
    filename: z.string(),
    title: z.string(),
    size: z.number(),
    /** Every part but the last is this many bytes. */
    partSize: z.number(),
    state: UploadState,
    /** The part numbers (from 1) received so far, so a resumed upload sends only the rest. */
    receivedParts: z.array(z.number().int()),
    /** Why it failed, in words for its person; null otherwise. */
    error: z.string().nullable(),
    /** Its library entry, once done. */
    entryId: Id.nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("Upload");
export type Upload = z.infer<typeof Upload>;

/**
 * A video's details to change, each only when given: for everyone on the caller's own upload, for
 * the caller alone on any other video of theirs (docs/library.md#your-own-details). `creator` is the
 * channel. A site's title may be longer than an upload's, so a client sends only what changed.
 */
export const EntryDetailsBody = z
  .object({
    title: Title.optional(),
    description: Description.nullable().optional(),
    creator: Creator.optional(),
  })
  .openapi("EntryDetailsBody");
export type EntryDetailsBody = z.input<typeof EntryDetailsBody>;
