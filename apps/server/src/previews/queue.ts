import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { DownloadQueues } from "../downloads/queues.ts";

/**
 * Hover previews (docs/library.md "Hover previews"): one short silent clip per media, made by the
 * `preview` job after a download or upload and by the leader's backfill, stored under `.previews/`
 * and served beside the thumbnail.
 */

/** Where a media's preview is stored (UUID-named, so no other key is ever the same). */
export const previewKey = (mediaId: string): string => `.previews/${mediaId}.mp4`;
/** One job per media: a second ask while one is live adds none. */
export const previewJobKey = (mediaId: string): string => `preview:${mediaId}`;

const ATTEMPTS = 2;
const RETRY_AFTER_MS = 60_000;

/** Queues a media's preview, unless one is live already (the job returns early when it exists). */
export async function queuePreview(
  deps: { queues: Pick<DownloadQueues, "preview"> },
  mediaId: string,
  tx?: Kysely<Database>,
): Promise<void> {
  await deps.queues.preview.add(
    "preview",
    { mediaId },
    {
      key: previewJobKey(mediaId),
      attempts: ATTEMPTS,
      backoff: { type: "fixed", delayMs: RETRY_AFTER_MS },
    },
    tx,
  );
}
