import type { DownloadContext } from "../downloads/dispatch.ts";
import type { PushService } from "../push/service.ts";
import type { OpenedLogin } from "../siteLogins/forJobs.ts";
import type { StorageConfig } from "../storage/config.ts";
import type { MediaStore } from "../storage/index.ts";
import type { PlaybackBus } from "../transcode/bus.ts";
import type { HwAccel, PipelineMemo } from "../transcode/hwaccel.ts";
import type { SubtitleSettings } from "./subtitles.ts";

/** What the probe and fetch processors need. */
export interface WorkerDeps extends DownloadContext {
  store: MediaStore;
  storage: StorageConfig;
  /** Per-job scratch directories go under here. */
  workDir: string;
  ytdlp: {
    binary: string;
    env?: Record<string, string>;
    cookiesFile: string | null;
    /**
     * `UROBOROS_SECRETS_KEY`, which opens people's saved site logins for their runs; null runs
     * without any.
     */
    secretsKey: Buffer | null;
    /**
     * The saved logins of the person a run is for, set per job by `withLoginsOf` (`logins.ts`);
     * a shared fetch reads its own (`loginsForFetch`).
     */
    logins?: readonly OpenedLogin[];
    /** Node, for yt-dlp's JavaScript challenges (the worker passes its own binary). */
    jsRuntime?: string;
  };
  ffprobe: { binary: string; env?: Record<string, string> };
  /** Subtitles saved with each download. */
  subtitles: SubtitleSettings;
  /** The process's push service, for the `notify` consumer. */
  push: PushService;
  /** Playback sessions this process runs at once (0: it takes none). */
  transcodeConcurrency: number;
  /** The replicas' playback bus (want/ready/stop), shared with the api. */
  playbackBus: PlaybackBus;
  /** Playback sessions' transcoder (docs/transcoding.md). */
  transcoder: Transcoder;
}

export interface Transcoder {
  ffmpeg: { binary: string; env?: Record<string, string> };
  ffprobe: { binary: string; env?: Record<string, string> };
  /** This replica's GPU (`UROBOROS_TRANSCODE_HWACCEL`). */
  hwaccel: HwAccel;
  vaapiDevice: string;
  /** Whether the GPU passed the startup test; false sends every run to the CPU. */
  gpuWorks: boolean;
  /** Pipelines that failed on a kind of source, on this replica. */
  memo: PipelineMemo;
}
