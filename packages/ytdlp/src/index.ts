/**
 * @uroboros/ytdlp: the typed wrapper the workers use to run yt-dlp, ffprobe and the transcoder's
 * ffmpeg. Only workers import it (the api takes the pure flags allowlist and error kinds); the api
 * never spawns any of them.
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
export { grabFrame, type FrameOptions } from "./frame.ts";
export {
  AUDIO_PREROLL_SECONDS,
  sessionArgs,
  type EncodeSettings,
  type Pipeline,
  type RunPlan,
} from "./ffmpegArgs.ts";
export {
  chaptersMetadata,
  exportArgs,
  exportFilterGraph,
  progressSeconds,
  type ExportPlan,
} from "./exportArgs.ts";
export {
  PREVIEW_SNIPPETS,
  previewArgs,
  previewWindows,
  SNIPPET_SECONDS,
  WHOLE_UNDER_SECONDS,
  type PreviewPlan,
} from "./previewArgs.ts";
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
  SponsorSegment,
  SubtitleTrack,
  Thumbnail,
  VideoInfo,
  parseInfo,
  type ProbeResult,
} from "./info.ts";
export { probe, type ProbeOptions } from "./probe.ts";
export type { ProgressEvent, ProgressPhase, ProgressState } from "./progress.ts";
export { redactLine } from "./redact.ts";
