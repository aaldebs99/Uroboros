import { mediaInputArgs } from "./ffmpegArgs.ts";
import {
  videoEncoderArgs,
  videoFilter,
  videoInputArgs,
  type EncodeSettings,
} from "./ffmpegVideo.ts";

/**
 * A video's hover preview (docs/library.md "Hover previews"): the whole video, scaled down and
 * encoded with its sound into an MP4 that starts playing at once and seeks anywhere, on the
 * replica's GPU or the CPU (the pipeline).
 */
export interface PreviewPlan {
  /** The file's path, or a presigned URL. */
  input: string;
  output: string;
  /** The video stream's index in the input, and how it is decoded, scaled and encoded. */
  video: { index: number } & EncodeSettings;
  /** The audio stream's index in the input; null for a file without sound. */
  audio: { index: number } | null;
  /** The VA-API render node, for a `vaapi` pipeline. */
  vaapiDevice: string;
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

/** What every preview drops, and how it is written: an MP4 that starts playing at once. */
const previewOutputArgs = (output: string): string[] => [
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
  output,
];

/**
 * The whole command line, after the binary: the file read once, start to end, its progress on
 * stdout (so a run that fails says whether it had encoded anything).
 */
export function previewArgs(p: PreviewPlan): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-progress",
    "pipe:1",
    "-nostats",
    ...videoInputArgs(p.video.pipeline, p.vaapiDevice),
    ...mediaInputArgs(p.input),
    "-i",
    p.input,
    "-map",
    `0:${String(p.video.index)}`,
    "-vf",
    videoFilter(p.video),
    ...videoEncoderArgs(p.video),
    ...audioArgs(p.audio),
    ...previewOutputArgs(p.output),
  ];
}

/**
 * A copy that already is a preview (one downloaded from the video's site at 480p, in H.264 with
 * AAC), rewritten as one without encoding anything: its streams copied as they are.
 */
export interface PreviewCopy {
  input: string;
  output: string;
  video: { index: number };
  audio: { index: number } | null;
}

/** The whole command line, after the binary: the streams copied, the rest dropped. */
export function previewCopyArgs(p: PreviewCopy): string[] {
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
    ...(p.audio === null ? ["-an"] : ["-map", `0:${String(p.audio.index)}`]),
    "-c",
    "copy",
    ...previewOutputArgs(p.output),
  ];
}
