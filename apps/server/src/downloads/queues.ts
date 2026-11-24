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

/**
 * Fetch a video's SponsorBlock segments again for one person's entry (the probe queue's `skips`
 * jobs; docs/automation.md#sponsorblock).
 */
export interface SkipsJob {
  entryId: string;
  userId: string;
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

/** Make a copy of a video without its SponsorBlock segments (docs/transcoding.md). */
export interface ExportJob {
  exportId: string;
}

/** Make a video's hover preview clip (docs/library.md "Hover previews"). */
export interface PreviewJob {
  mediaId: string;
}

/** One push to all of a person's devices (`notify` queue; docs/push.md). */
export interface NotifyJob {
  userId: string;
  message: Message;
  urgency: Urgency;
}

export interface DownloadQueues {
  /** Pasted links' probes, and (`skips`) SponsorBlock refetches: both one quick yt-dlp probe. */
  probe: JobQueue<ProbeJob | SkipsJob>;
  download: JobQueue<FetchJob>;
  /** Subscription checks and "latest" downloads (docs/automation.md). */
  automation: JobQueue<CheckJob>;
  notify: JobQueue<NotifyJob>;
  /** Playback sessions' runs (docs/transcoding.md). */
  playback: JobQueue<PlaybackJob>;
  /** Finished uploads, filed in their person's library (docs/uploads.md). */
  upload: JobQueue<UploadJob>;
  /** Copies without SponsorBlock segments, re-encoded to save (docs/transcoding.md). */
  export: JobQueue<ExportJob>;
  /** Hover preview clips (docs/library.md). */
  preview: JobQueue<PreviewJob>;
}

/** The producer side of every queue (docs/jobs.md). */
export function createDownloadQueues(db: Kysely<Database>): DownloadQueues {
  return {
    probe: new JobQueue<ProbeJob | SkipsJob>(db, "probe"),
    download: new JobQueue<FetchJob>(db, "download"),
    automation: new JobQueue<CheckJob>(db, "automation"),
    notify: new JobQueue<NotifyJob>(db, "notify"),
    playback: new JobQueue<PlaybackJob>(db, "playback"),
    upload: new JobQueue<UploadJob>(db, "upload"),
    export: new JobQueue<ExportJob>(db, "export"),
    preview: new JobQueue<PreviewJob>(db, "preview"),
  };
}
