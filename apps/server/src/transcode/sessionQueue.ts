import type { Queue } from "bullmq";

/** Playback sessions' runs, consumed where UROBOROS_TRANSCODE_CONCURRENCY allows (docs/transcoding.md). */
export const PLAYBACK_QUEUE = "playback";

export interface PlaybackJob {
  sessionId: string;
}

/** Queues a session's runner. FIFO: viewers wait their turn for a free transcoder. */
export async function addPlaybackJob(q: Queue<PlaybackJob>, sessionId: string): Promise<void> {
  await q.add(
    "playback",
    { sessionId },
    {
      jobId: `playback|${sessionId}`,
      // The runner records its own failures; a shutdown moves it back without spending one.
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
