import { mediaInputArgs } from "./ffmpegArgs.ts";
import { videoEncoderArgs, videoFilter, type EncodeSettings } from "./ffmpegVideo.ts";

/**
 * A video's hover preview (docs/library.md "Hover previews"): the whole video, scaled down and
 * encoded on the CPU with its sound into an MP4 that starts playing at once and seeks anywhere.
 */
export interface PreviewPlan {
  /** The file's path, or a presigned URL. */
  input: string;
  output: string;
  /** The video stream's index in the input, and how it is encoded (the CPU pipeline). */
  video: { index: number } & EncodeSettings;
  /** The audio stream's index in the input; null for a file without sound. */
  audio: { index: number } | null;
}

/** Stereo AAC at this rate: plenty for a tile's speaker, and small beside the picture. */
const PREVIEW_AUDIO_BITRATE = "96k";

function audioArgs(audio: PreviewPlan["audio"]): string[] {
  if (audio === null) return ["-an"];
  return [
    "-map",
    `0:${String(audio.index)}`,
    "-c:a",
    "aac",
    "-b:a",
    PREVIEW_AUDIO_BITRATE,
    "-ac",
    "2",
  ];
}

/** The whole command line, after the binary: the file read once, start to end. */
export function previewArgs(p: PreviewPlan): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    ...mediaInputArgs(p.input),
    "-i",
    p.input,
    "-map",
    `0:${String(p.video.index)}`,
    "-vf",
    videoFilter(p.video),
    ...videoEncoderArgs(p.video),
    ...audioArgs(p.audio),
    "-sn",
    "-dn",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    "-y",
    p.output,
  ];
}
