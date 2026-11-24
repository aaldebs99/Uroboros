import { COPYABLE_AUDIO, COPYABLE_VIDEO } from "./codecs.ts";
import { h264Level, outputSize, rungFor } from "./ladder.ts";

/**
 * What a playback session will serve (docs/transcoding.md), decided from the stored rendition's
 * facts and what the page asked for, before anything runs: the playlist needs the codecs, the
 * size and the boundaries at once.
 */

export type Quality = "original" | "2160" | "1440" | "1080" | "720" | "480" | "360";

/** Why the session is not direct play, for the page's status line. */
export type PlaybackReason =
  | "picked"
  | "container"
  | "audio_unsupported"
  | "video_unsupported"
  | "video_not_copyable";

export interface RenditionFacts {
  duration: number;
  width: number | null;
  height: number | null;
  /** ffprobe's codec names and the stored RFC 6381 strings (codecs.ts). */
  videoCodec: string | null;
  videoCodecs: string | null;
  audioCodec: string | null;
  audioCodecs: string | null;
}

export interface PlanRequest {
  quality: Quality;
  /** Whether the browser decodes the source's video / audio from fragmented MP4. */
  copyVideo: boolean;
  copyAudio: boolean;
}

export interface SessionPlan {
  mode: "remux" | "encode" | "audio";
  quality: Quality;
  width: number | null;
  height: number | null;
  /** The encode's bitrate cap, or null when the video is copied or absent. */
  bitrate: number | null;
  /** The encode's H.264 level (`-level`), matching its codec string. */
  level: number | null;
  audio: "copy" | "aac" | null;
  codecs: string[];
  bandwidth: number;
  boundaries: "uniform" | "keyframes";
  reason: PlaybackReason;
}

/** "original" encodes at the source's size, up to this many lines on the short side. */
const ORIGINAL_MAX_SHORT = 1080;
const AUDIO_BITRATE = 160_000;
const AAC = "mp4a.40.2";

interface AudioPart {
  audio: SessionPlan["audio"];
  codecs: string[];
  rate: number;
  reason: PlaybackReason;
}

/** The audio: copied when the browser plays it and fragmented MP4 carries it, else AAC. */
function audioPart(f: RenditionFacts, r: PlanRequest): AudioPart {
  if (f.audioCodec === null) return { audio: null, codecs: [], rate: 0, reason: "container" };
  const copy = r.copyAudio && f.audioCodecs !== null && COPYABLE_AUDIO.has(f.audioCodec);
  return copy
    ? { audio: "copy", codecs: [f.audioCodecs as string], rate: AUDIO_BITRATE, reason: "container" }
    : { audio: "aac", codecs: [AAC], rate: AUDIO_BITRATE, reason: "audio_unsupported" };
}

function encodePlan(
  f: RenditionFacts & { width: number; height: number },
  r: PlanRequest,
  a: AudioPart,
  copyable: boolean,
): SessionPlan {
  const short =
    r.quality === "original" ? Math.min(f.width, f.height, ORIGINAL_MAX_SHORT) : Number(r.quality);
  const size = outputSize(f.width, f.height, short);
  const level = h264Level(size.width, size.height);
  const bitrate = rungFor(Math.min(size.width, size.height)).bitrate;
  let reason: PlaybackReason = "picked";
  if (r.quality === "original") reason = copyable ? "video_unsupported" : "video_not_copyable";
  return {
    mode: "encode",
    quality: r.quality,
    ...size,
    bitrate,
    level: level.idc,
    audio: a.audio,
    codecs: [level.codec, ...a.codecs],
    bandwidth: bitrate + a.rate,
    boundaries: "uniform",
    reason,
  };
}

export function planSession(f: RenditionFacts, r: PlanRequest): SessionPlan {
  const a = audioPart(f, r);
  const { width, height, videoCodec } = f;
  if (videoCodec === null || width === null || height === null) {
    return {
      mode: "audio",
      quality: r.quality,
      width: null,
      height: null,
      bitrate: null,
      level: null,
      audio: a.audio,
      codecs: a.codecs,
      bandwidth: AUDIO_BITRATE,
      boundaries: "uniform",
      reason: a.reason,
    };
  }
  const copyable = COPYABLE_VIDEO.has(videoCodec) && f.videoCodecs !== null;
  if (r.quality !== "original" || !r.copyVideo || !copyable) {
    return encodePlan({ ...f, width, height }, r, a, copyable);
  }
  return {
    mode: "remux",
    quality: r.quality,
    width,
    height,
    bitrate: null,
    level: null,
    audio: a.audio,
    codecs: [f.videoCodecs as string, ...a.codecs],
    bandwidth: rungFor(Math.min(width, height)).bitrate + a.rate,
    boundaries: "keyframes",
    reason: a.reason,
  };
}
