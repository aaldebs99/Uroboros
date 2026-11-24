import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { publishDownloadEvents, type InternalEvent } from "../downloads/events.ts";
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

/** People who hear of a change in one message at most (a notification's payload is 8000 bytes). */
const ANNOUNCE_CHUNK = 100;

/**
 * Tells the people who have `mediaId` in their library that its preview was queued, started or
 * finished, so their bells ask again (`GET /api/previews`). On a transaction, it is heard at commit.
 */
export async function announcePreview(db: Kysely<Database>, mediaId: string): Promise<void> {
  const people = await db
    .selectFrom("library_entries")
    .select("user_id")
    .distinct()
    .where("media_id", "=", mediaId)
    // In order, so the same people make the same payload (folded within a transaction).
    .orderBy("user_id")
    .execute();
  const events: InternalEvent[] = [];
  for (let i = 0; i < people.length; i += ANNOUNCE_CHUNK) {
    const userIds = people.slice(i, i + ANNOUNCE_CHUNK).map((p) => p.user_id);
    events.push({ kind: "previews", userIds });
  }
  if (events.length > 0) await publishDownloadEvents(db, events);
}

/**
 * Queues a media's preview, unless one is live already (the job returns early when it exists), and
 * tells its people.
 */
export async function queuePreview(
  deps: { queues: Pick<DownloadQueues, "preview"> },
  mediaId: string,
  tx?: Kysely<Database>,
): Promise<void> {
  const added = await deps.queues.preview.add(
    "preview",
    { mediaId },
    {
      key: previewJobKey(mediaId),
      attempts: ATTEMPTS,
      backoff: { type: "fixed", delayMs: RETRY_AFTER_MS },
    },
    tx,
  );
  if (added) await announcePreview(tx ?? deps.queues.preview.db, mediaId);
}
