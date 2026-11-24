/**
 * @uroboros/ytdlp: the typed wrapper the workers use to run yt-dlp and ffprobe. Only workers
 * import it; the api never spawns either program.
 */
export type { SiteLoginSecret, YtDlpOptions } from "./args.ts";
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
  AUDIO_PREROLL_SECONDS,
  sessionArgs,
  type EncodeSettings,
  type Pipeline,
  type RunPlan,
} from "./ffmpegArgs.ts";
export { checkEncoder, type EncoderCheck, type EncoderCheckOptions } from "./encoderCheck.ts";
export { probeKeyframes, type KeyframeOptions } from "./keyframes.ts";
export {
  meaningfulLine,
  spawnStream,
  type StreamExit,
  type StreamOptions,
  type StreamProcess,
} from "./streamProcess.ts";
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
