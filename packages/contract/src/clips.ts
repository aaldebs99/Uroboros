import { z } from "@hono/zod-openapi";

/**
 * Clips (docs/sharing.md#clips): a range of a video picked in the player, saved as its own cut file
 * or shared, on its own or as the whole video opened at it.
 */

/** The shortest clip, in seconds. */
export const CLIP_MIN_SECONDS = 1;

/**
 * How far past the file's end a clip may be asked to run, in seconds (a frame or so: the player's
 * length can differ from the file's). The server ends such a clip at the file's end.
 */
export const CLIP_END_SLACK = 1;

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

/**
 * Whether a copy is the clip `asked` for: the same range, or one the server ended at the file's end
 * up to `CLIP_END_SLACK` before the asked end. A clip's copy cuts what lies before its start and
 * after its end, so one running to the file's end cuts only its start.
 */
export function answersClip(
  asked: ClipRange,
  copy: { clip: ClipRange | null; cutSeconds: number },
): boolean {
  const got = copy.clip;
  if (got === null || got.start !== asked.start) return false;
  if (got.end === asked.end) return true;
  const short = ms(asked.end - got.end);
  return short > 0 && short <= CLIP_END_SLACK && ms(copy.cutSeconds) === ms(got.start);
}

/** `POST /api/library/{id}/export`: a copy without SponsorBlock segments, or with `clip` one range. */
export const ExportBody = z.object({ clip: ClipRange.optional() }).openapi("ExportBody");
export type ExportBody = z.infer<typeof ExportBody>;
