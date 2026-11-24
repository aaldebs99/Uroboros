import { z } from "@hono/zod-openapi";

/**
 * Copies to save (docs/transcoding.md): a video re-encoded without its SponsorBlock segments, made
 * by a job for one person and kept until they remove it.
 */

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
    /** Where to save it from, once done. */
    fileUrl: z.string().nullable(),
    /**
     * Cut from the segments the video's file has now: false once a SponsorBlock refetch changed
     * them (docs/automation.md#sponsorblock), when asking again makes a new copy.
     */
    current: z.boolean(),
  })
  .openapi("Export");
export type Export = z.infer<typeof Export>;
