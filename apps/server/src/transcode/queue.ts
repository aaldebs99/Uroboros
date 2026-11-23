import type { Queue } from "bullmq";

/** Compatible copies, made by every replica's consumer (docs/transcoding.md). */
export const TRANSCODE_QUEUE = "transcode";

export interface TranscodeJob {
  transcodeId: string;
}

/**
 * Queues a copy (a second add while one waits is the same job). LIFO: the latest request, usually
 * the video someone just opened, goes first.
 */
export async function addTranscodeJob(q: Queue<TranscodeJob>, transcodeId: string): Promise<void> {
  await q.add(
    "transcode",
    { transcodeId },
    {
      jobId: `transcode|${transcodeId}`,
      lifo: true,
      // A run cut by shutdown fails its attempt and runs again (ffmpeg's own failures do not throw).
      attempts: 3,
      backoff: { type: "fixed", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
