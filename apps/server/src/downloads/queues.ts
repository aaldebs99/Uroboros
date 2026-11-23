import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Message } from "../push/pusher.ts";
import type { Urgency } from "../push/sender.ts";
import { AUTOMATION_QUEUE, type CheckJob } from "../subscriptions/queue.ts";
import { TRANSCODE_QUEUE, type TranscodeJob } from "../transcode/queue.ts";
import type { ProfileArgs } from "./profiles.ts";

export const PROBE_QUEUE = "probe";
export const DOWNLOAD_QUEUE = "download";

/** Probe a pasted link (docs/downloads.md). */
export interface ProbeJob {
  requestId: string;
}

/** Fetch one video in one profile revision; every download waiting on `fetchKey` is settled. */
export interface FetchJob {
  fetchKey: string;
  extractor: string;
  videoId: string;
  url: string;
  profileId: string;
  profileName: string;
  revision: string;
  args: ProfileArgs;
}

/** One push to all of a person's devices (`notify` queue; docs/push.md). */
export interface NotifyJob {
  userId: string;
  message: Message;
  urgency: Urgency;
}

export const NOTIFY_QUEUE = "notify";

export interface DownloadQueues {
  probe: Queue<ProbeJob>;
  download: Queue<FetchJob>;
  /** Subscription checks: one job scheduler per subscription (docs/automation.md). */
  automation: Queue<CheckJob>;
  notify: Queue<NotifyJob>;
  /** Compatible playback copies (docs/transcoding.md). */
  transcode: Queue<TranscodeJob>;
  close(): Promise<void>;
}

/** The producer side of the probe, download, automation and notify queues. */
export function createDownloadQueues(connection: Redis, prefix: string): DownloadQueues {
  const probe = new Queue<ProbeJob>(PROBE_QUEUE, { connection, prefix });
  const download = new Queue<FetchJob>(DOWNLOAD_QUEUE, { connection, prefix });
  const automation = new Queue<CheckJob>(AUTOMATION_QUEUE, { connection, prefix });
  const notify = new Queue<NotifyJob>(NOTIFY_QUEUE, { connection, prefix });
  const transcode = new Queue<TranscodeJob>(TRANSCODE_QUEUE, { connection, prefix });
  return {
    probe,
    download,
    automation,
    notify,
    transcode,
    async close() {
      await Promise.all([probe, download, automation, notify, transcode].map((q) => q.close()));
    },
  };
}
