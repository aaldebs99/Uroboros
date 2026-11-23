/**
 * @uroboros/ytdlp: the typed wrapper the workers use to run yt-dlp and ffprobe. Only workers
 * import it; the api never spawns either program.
 */
export type { YtDlpOptions } from "./args.ts";
export {
  download,
  DEFAULT_OUTPUT_TEMPLATE,
  type DownloadedFile,
  type DownloadOptions,
  type DownloadResult,
} from "./download.ts";
export { YTDLP_ERROR_KINDS, YtDlpError, type YtDlpErrorKind } from "./errors.ts";
export { ALLOWED_FLAGS, normalizeExtraArgs } from "./flags.ts";
export { ffprobe, MediaInfo, MediaStream, type FfprobeOptions } from "./ffprobe.ts";
export {
  Chapter,
  Format,
  PlaylistEntry,
  PlaylistInfo,
  SubtitleTrack,
  Thumbnail,
  VideoInfo,
  parseInfo,
  type ProbeResult,
} from "./info.ts";
export { probe, type ProbeOptions } from "./probe.ts";
export {
  hlsArgs,
  transcodeHls,
  type HlsEncoder,
  type HlsMode,
  type HlsPlan,
  type TranscodeOptions,
} from "./transcode.ts";
export type { ProgressEvent, ProgressPhase, ProgressState } from "./progress.ts";
export { redactLine } from "./redact.ts";
