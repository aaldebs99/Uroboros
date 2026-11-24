import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { JobQueue } from "../jobs/queues.ts";

/** A playback session's run, on the `playback` queue (docs/transcoding.md). */
export interface PlaybackJob {
  sessionId: string;
}

/**
 * Queues a session's runner (`playback|<id>`: one per session). FIFO: viewers wait their turn for
 * a free transcoder. One attempt: the runner records its own failures, and a shutdown puts it back
 * without spending one.
 */
export async function addPlaybackJob(
  q: JobQueue<PlaybackJob>,
  sessionId: string,
  on?: Kysely<Database>,
): Promise<void> {
  await q.add("playback", { sessionId }, { key: `playback|${sessionId}` }, on);
}
