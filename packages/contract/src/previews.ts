import { z } from "@hono/zod-openapi";

/**
 * The caller's hover previews being made (docs/library.md "Hover previews"), for the bell's "In
 * progress" (docs/push.md#the-list-in-the-app). Counted over the videos in the caller's library.
 */
export const PreviewWork = z
  .object({
    /**
     * Videos whose preview waits or is being made: while previews are on, every one still without
     * a preview (none that failed for good: the backfill gets to them); while off, those already
     * queued. 0 while previews are stalled (no replica makes them), and when nothing is in progress.
     */
    waiting: z.number().int().nonnegative(),
    /** The one being made now, else the next queued; null when none is queued. */
    next: z.object({ entryId: z.uuid(), title: z.string(), running: z.boolean() }).nullable(),
  })
  .openapi("PreviewWork");
export type PreviewWork = z.infer<typeof PreviewWork>;
