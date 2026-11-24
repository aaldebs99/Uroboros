import {
  type EncodeSettings,
  FORCE_KEYFRAMES,
  videoEncoderArgs,
  videoFilter,
  videoInputArgs,
} from "./ffmpegVideo.ts";

export type { EncodeSettings, Pipeline } from "./ffmpegVideo.ts";

/**
 * One run of a playback session (docs/transcoding.md): ffmpeg from a segment boundary to the end
 * of the source, writing fragmented MP4 to stdout on the source's own timeline, so runs started
 * at different boundaries fit together.
 */
export interface RunPlan {
  /** A file path, or a URL (an S3 object). */
  input: string;
  /** The run's first boundary, in seconds: a forced keyframe, or a source keyframe for a remux. */
  start: number;
  mode: "remux" | "encode" | "audio";
  /** Stream indexes are absolute (ffprobe's `index`). */
  video:
    | { index: number; copy: true; hevc: boolean }
    | ({ index: number; copy: false } & EncodeSettings)
    | null;
  audio: { index: number; copy: boolean } | null;
  vaapiDevice: string;
}

/**
 * How far before a later run's start its audio begins: the run before it leaves its last segment's
 * audio a few frames short of the boundary, and a browser stalls on that gap. The overlap is
 * simply replaced.
 */
export const AUDIO_PREROLL_SECONDS = 0.25;
/** A remux seeks just past its keyframe, so rounding never lands it on the one before. */
const KEYFRAME_NUDGE = 0.0005;

const FRAGMENTS = "+empty_moov+default_base_moof+frag_discont+negative_cts_offsets+skip_trailer";
const NETWORK = [
  "-reconnect",
  "1",
  "-reconnect_on_network_error",
  "1",
  "-reconnect_delay_max",
  "10",
  "-protocol_whitelist",
  "http,https,tcp,tls,crypto",
];

const isUrl = (input: string) => /^https?:\/\//.test(input);
const seconds = (t: number) => Math.max(0, t).toFixed(4);

function input(p: RunPlan, seek: number | null, before: string[] = []): string[] {
  return [
    ...before,
    ...(seek === null ? [] : ["-ss", seconds(seek)]),
    ...(isUrl(p.input) ? NETWORK : []),
    "-i",
    p.input,
  ];
}

/** The inputs: the video, and when a run starts later, the audio again a little earlier. */
function inputs(p: RunPlan): { args: string[]; audioInput: number } {
  const later = p.start > 0;
  if (p.mode === "audio") {
    return { args: input(p, later ? p.start - AUDIO_PREROLL_SECONDS : null), audioInput: 0 };
  }
  const v = p.video;
  const hw = v !== null && !v.copy ? videoInputArgs(v.pipeline, p.vaapiDevice) : [];
  const seek = later ? p.start + (p.mode === "remux" ? KEYFRAME_NUDGE : 0) : null;
  const first = input(p, seek, hw);
  if (!later || p.audio === null) return { args: first, audioInput: 0 };
  return {
    args: [...first, ...input(p, p.start - AUDIO_PREROLL_SECONDS)],
    audioInput: 1,
  };
}

function videoArgs(p: RunPlan): string[] {
  const v = p.video;
  if (v === null || p.mode === "audio") return [];
  if (v.copy) return ["-c:v", "copy", ...(v.hevc ? ["-tag:v", "hvc1"] : [])];
  return ["-vf", videoFilter(v), ...videoEncoderArgs(v), "-force_key_frames", FORCE_KEYFRAMES];
}

function audioArgs(p: RunPlan): string[] {
  if (p.audio === null) return [];
  return p.audio.copy ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "160k", "-ac", "2"];
}

/** The whole command line for one run, after the binary. */
export function sessionArgs(p: RunPlan): string[] {
  const { args, audioInput } = inputs(p);
  const video = p.mode !== "audio" && p.video !== null;
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-copyts",
    "-start_at_zero",
    ...args,
    ...(video ? ["-map", `0:${String(p.video?.index)}`] : []),
    ...(p.audio === null ? [] : ["-map", `${String(audioInput)}:${String(p.audio.index)}`]),
    ...(video ? ["-fps_mode:v", "passthrough"] : []),
    ...videoArgs(p),
    ...audioArgs(p),
    "-avoid_negative_ts",
    "disabled",
    "-f",
    "mp4",
    "-movflags",
    (video ? "+frag_keyframe" : "+frag_every_frame") + FRAGMENTS,
    "-use_editlist",
    "0",
    "-fflags",
    "+bitexact",
    ...(video ? ["-flags:v", "+bitexact"] : []),
    "-flags:a",
    "+bitexact",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "pipe:1",
  ];
}
