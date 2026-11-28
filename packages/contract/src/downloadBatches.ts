import { z } from "@hono/zod-openapi";

/**
 * A pasted playlist or channel the person queued that still has videos waiting or downloading
 * (`GET /api/downloads/batches`), so its rest can be cancelled together (docs/downloads.md).
 */
export const DownloadBatch = z
  .object({
    /** The pasted link's request, which `POST /api/downloads/requests/{id}/cancel` takes. */
    id: z.uuid(),
    url: z.string(),
    title: z.string().nullable(),
    kind: z.enum(["playlist", "channel"]),
    /** Its videos still queued or downloading, those done, and those that failed. */
    waiting: z.number().int(),
    done: z.number().int(),
    failed: z.number().int(),
  })
  .openapi("DownloadBatch");
export type DownloadBatch = z.infer<typeof DownloadBatch>;

/** What cancelling a batch's rest did: how many of its videos stopped waiting. */
export const CancelledBatch = z.object({ cancelled: z.number().int() }).openapi("CancelledBatch");
export type CancelledBatch = z.infer<typeof CancelledBatch>;
