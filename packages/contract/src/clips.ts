import { z } from "@hono/zod-openapi";

/**
 * Clips (docs/sharing.md#clips): a range of a video picked in the player, saved as its own cut file
 * or shared, on its own or as the whole video opened at it.
 */

/** The shortest clip, in seconds. */
export const CLIP_MIN_SECONDS = 1;

/** A range of a video's file, in seconds on its timeline. */
export const ClipRange = z
  .object({
    start: z.number().min(0),
    end: z.number(),
  })
  .refine((r) => r.end - r.start >= CLIP_MIN_SECONDS, {
    message: `a clip runs from its start to an end at least ${String(CLIP_MIN_SECONDS)} s later`,
  })
  .openapi("ClipRange");
export type ClipRange = z.infer<typeof ClipRange>;

const ms = (t: number) => Math.round(t * 1000) / 1000;

/** A range rounded to milliseconds, as the server keeps it (and compares asks for one). */
export const roundClip = (r: ClipRange): ClipRange => ({ start: ms(r.start), end: ms(r.end) });

/** `POST /api/library/{id}/export`: a copy without SponsorBlock segments, or with `clip` one range. */
export const ExportBody = z.object({ clip: ClipRange.optional() }).openapi("ExportBody");
export type ExportBody = z.infer<typeof ExportBody>;
