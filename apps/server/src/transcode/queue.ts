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
    { jobId: `transcode|${transcodeId}`, lifo: true, removeOnComplete: true, removeOnFail: true },
  );
}
