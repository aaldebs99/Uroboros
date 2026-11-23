import { Queue } from "bullmq";
import type { Redis } from "ioredis";
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

export interface DownloadQueues {
  probe: Queue<ProbeJob>;
  download: Queue<FetchJob>;
  close(): Promise<void>;
}

/** The producer side of the probe and download queues. */
export function createDownloadQueues(connection: Redis, prefix: string): DownloadQueues {
  const probe = new Queue<ProbeJob>(PROBE_QUEUE, { connection, prefix });
  const download = new Queue<FetchJob>(DOWNLOAD_QUEUE, { connection, prefix });
  return {
    probe,
    download,
    async close() {
      await Promise.all([probe.close(), download.close()]);
    },
  };
}
