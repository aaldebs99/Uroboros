import { z } from "@hono/zod-openapi";

import { ClipRange } from "./clips.ts";
import { ExportState } from "./exports.ts";
import { Chapter } from "./library.ts";

/**
 * A clip shared on its own (docs/sharing.md#clips), as its recipient or a public link's viewer gets
 * it: the cut file of one range of a video, never the rest. Its URLs are under the share
 * (`/api/clips/{id}` signed in, `/api/public/s/{code}/clip` by a link); the file plays and saves
 * once it is made.
 */
export const ClipItem = z
  .object({
    /** The copy's id. */
    id: z.uuid(),
    /** The clip's title: its video's, with the range (`Trip (clip 1:02–1:30)`). */
    title: z.string(),
    channel: z.string().nullable(),
    /** The range of the video it keeps, in seconds on the video's timeline. */
    range: ClipRange,
    /** How long the clip runs, in seconds. */
    duration: z.number(),
    /** The copy being made (queued, running), made (done), or not (failed: `error` says why). */
    state: ExportState,
    progress: z.number().min(0).max(1).nullable(),
    error: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
    /** The chapters it overlaps, on its own timeline. */
    chapters: z.array(Chapter),
    /** Null until the copy is made. */
    streamUrl: z.string().nullable(),
    /** Null until it is made, and on a link that doesn't allow downloads. */
    fileUrl: z.string().nullable(),
    /** A file with sound alone. */
    audioOnly: z.boolean(),
    /** Who shared it; null when it is the caller's own. */
    owner: z.string().nullable(),
  })
  .openapi("ClipItem");
export type ClipItem = z.infer<typeof ClipItem>;
