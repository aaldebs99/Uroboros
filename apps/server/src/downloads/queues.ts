import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { JobQueue } from "../jobs/queues.ts";
import type { Message } from "../push/pusher.ts";
import type { Urgency } from "../push/sender.ts";
import type { CheckJob } from "../subscriptions/queue.ts";
import type { PlaybackJob } from "../transcode/sessionQueue.ts";
import type { ProfileArgs } from "./profiles.ts";

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

/** File a finished upload in its person's library (docs/uploads.md). */
export interface UploadJob {
  uploadId: string;
}

/** One push to all of a person's devices (`notify` queue; docs/push.md). */
export interface NotifyJob {
  userId: string;
  message: Message;
  urgency: Urgency;
}

export interface DownloadQueues {
  probe: JobQueue<ProbeJob>;
  download: JobQueue<FetchJob>;
  /** Subscription checks and "latest" downloads (docs/automation.md). */
  automation: JobQueue<CheckJob>;
  notify: JobQueue<NotifyJob>;
  /** Playback sessions' runs (docs/transcoding.md). */
  playback: JobQueue<PlaybackJob>;
  /** Finished uploads, filed in their person's library (docs/uploads.md). */
  upload: JobQueue<UploadJob>;
}

/** The producer side of every queue (docs/jobs.md). */
export function createDownloadQueues(db: Kysely<Database>): DownloadQueues {
  return {
    probe: new JobQueue<ProbeJob>(db, "probe"),
    download: new JobQueue<FetchJob>(db, "download"),
    automation: new JobQueue<CheckJob>(db, "automation"),
    notify: new JobQueue<NotifyJob>(db, "notify"),
    playback: new JobQueue<PlaybackJob>(db, "playback"),
    upload: new JobQueue<UploadJob>(db, "upload"),
  };
}
