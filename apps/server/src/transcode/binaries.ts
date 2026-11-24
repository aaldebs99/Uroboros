import { existsSync } from "node:fs";

/** Where the image installs jellyfin-ffmpeg, the transcoder (scripts/image/install-jellyfin-ffmpeg.sh). */
export const JELLYFIN_FFMPEG_DIR = "/usr/lib/jellyfin-ffmpeg";

export interface TranscoderPaths {
  ffmpeg: string;
  ffprobe: string;
  /** Whether these are jellyfin-ffmpeg's (the GPU filters need it), not whatever is on PATH. */
  jellyfin: boolean;
}

/**
 * The transcoder's binaries: jellyfin-ffmpeg where the image puts it, else `ffmpeg` and `ffprobe`
 * on PATH (a server run from source on a host), which plays on the CPU at best. Downloads always
 * use yt-dlp's ffmpeg on PATH.
 */
export function transcoderPaths(exists: (path: string) => boolean = existsSync): TranscoderPaths {
  const ffmpeg = `${JELLYFIN_FFMPEG_DIR}/ffmpeg`;
  return exists(ffmpeg)
    ? { ffmpeg, ffprobe: `${JELLYFIN_FFMPEG_DIR}/ffprobe`, jellyfin: true }
    : { ffmpeg: "ffmpeg", ffprobe: "ffprobe", jellyfin: false };
}
