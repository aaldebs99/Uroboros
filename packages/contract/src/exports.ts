import { z } from "@hono/zod-openapi";

/**
 * Copies to save (docs/transcoding.md): a video re-encoded without its SponsorBlock segments, made
 * by a job for one person and kept for a day.
 */

/** How long a finished copy stays to be saved. */
export const EXPORT_KEEP_HOURS = 24;

export const ExportState = z.enum(["queued", "running", "done", "failed"]).openapi("ExportState");
export type ExportState = z.infer<typeof ExportState>;

export const Export = z
  .object({
    id: z.uuid(),
    /** The library entry it was made from. */
    entryId: z.uuid(),
    title: z.string(),
    state: ExportState,
    /** How far the encode is, 0 to 1, while it runs; null before. */
    progress: z.number().min(0).max(1).nullable(),
    /** The encoder it runs on: `libx264` (the CPU), `nvenc` or `vaapi`. */
    encoder: z.string().nullable(),
    /** Why it failed, for its person. */
    error: z.string().nullable(),
    sizeBytes: z.number().int().nullable(),
    /** Seconds of video the copy keeps, and the seconds it cuts. */
    keptSeconds: z.number().nullable(),
    cutSeconds: z.number(),
    createdAt: z.iso.datetime(),
    /** When a finished copy goes; null until it finishes. */
    expiresAt: z.iso.datetime().nullable(),
    /** Where to save it from, once done. */
    fileUrl: z.string().nullable(),
  })
  .openapi("Export");
export type Export = z.infer<typeof Export>;
