import { z } from "@hono/zod-openapi";

/**
 * The caller's hover previews being made (docs/library.md "Hover previews"), for the bell's "In
 * progress" (docs/push.md#the-list-in-the-app). Counted over the videos in the caller's library.
 */
export const PreviewWork = z
  .object({
    /** Videos whose preview is waiting or being made; nothing is in progress at 0. */
    queued: z.number().int().nonnegative(),
    /** Videos still without a preview (none that failed for good), and videos with one. */
    left: z.number().int().nonnegative(),
    made: z.number().int().nonnegative(),
    /** The one being made now, else the next to be; null at 0 queued. */
    next: z.object({ entryId: z.uuid(), title: z.string(), running: z.boolean() }).nullable(),
  })
  .openapi("PreviewWork");
export type PreviewWork = z.infer<typeof PreviewWork>;
