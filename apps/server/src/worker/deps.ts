import type { DownloadContext } from "../downloads/dispatch.ts";
import type { PushService } from "../push/service.ts";
import type { StorageConfig } from "../storage/config.ts";
import type { MediaStore } from "../storage/index.ts";
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
    /** Node, for yt-dlp's JavaScript challenges (the worker passes its own binary). */
    jsRuntime?: string;
  };
  ffprobe: { binary: string; env?: Record<string, string> };
  /** Subtitles saved with each download. */
  subtitles: SubtitleSettings;
  /** The process's push service, for the `notify` consumer. */
  push: PushService;
  /** The ffmpeg the `transcode` consumer runs. */
  ffmpeg: { binary: string; env?: Record<string, string> };
  /** Playback copies this process makes at once (0: it takes none). */
  transcodeConcurrency: number;
}
