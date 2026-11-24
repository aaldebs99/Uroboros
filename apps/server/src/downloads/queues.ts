import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { JobQueue } from "../jobs/queues.ts";
import type { Message } from "../push/pusher.ts";
import type { Urgency } from "../push/sender.ts";
import { AUTOMATION_QUEUE, type CheckJob } from "../subscriptions/queue.ts";
import { PLAYBACK_QUEUE, type PlaybackJob } from "../transcode/sessionQueue.ts";
import type { ProfileArgs } from "./profiles.ts";

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

export interface DownloadQueues {
  /** On Postgres (docs/jobs.md). */
  probe: JobQueue<ProbeJob>;
  download: Queue<FetchJob>;
  /** Subscription checks (docs/automation.md). */
  automation: Queue<CheckJob>;
  /** On Postgres (docs/jobs.md). */
  notify: JobQueue<NotifyJob>;
  /** Playback sessions' runs (docs/transcoding.md). */
  playback: Queue<PlaybackJob>;
  close(): Promise<void>;
}

/** The producer side of the queues: BullMQ's on `connection`, ours on `db`. */
export function createDownloadQueues(
  connection: Redis,
  prefix: string,
  db: Kysely<Database>,
): DownloadQueues {
  const probe = new JobQueue<ProbeJob>(db, "probe");
  const download = new Queue<FetchJob>(DOWNLOAD_QUEUE, { connection, prefix });
  const automation = new Queue<CheckJob>(AUTOMATION_QUEUE, { connection, prefix });
  const notify = new JobQueue<NotifyJob>(db, "notify");
  const playback = new Queue<PlaybackJob>(PLAYBACK_QUEUE, { connection, prefix });
  return {
    probe,
    download,
    automation,
    notify,
    playback,
    async close() {
      await Promise.all([download, automation, playback].map((q) => q.close()));
    },
  };
}
