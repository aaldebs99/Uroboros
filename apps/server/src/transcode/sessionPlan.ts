import { COPYABLE_AUDIO, COPYABLE_VIDEO } from "./codecs.ts";
import { h264Level, MAX_SHORT, outputSize, rungFor } from "./ladder.ts";

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
  /** The file's overall bits per second (its size over its length); null when unknown. */
  bitrate: number | null;
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

const AUDIO_BITRATE = 160_000;
const AAC = "mp4a.40.2";

/**
 * How many times the source codec's bits H.264 needs for the same picture: AV1 packs about twice as
 * much into a bit, VP9 and HEVC about one and a half; an H.264 source gets a margin, since encoding
 * it again loses some. Anything else, one and a half.
 */
const H264_NEED: Partial<Record<string, number>> = { av1: 2, vp9: 1.5, hevc: 1.5, h264: 1.25 };
const OTHER_NEED = 1.5;
/** No encode goes under this, whatever a broken size says. */
const MIN_BITRATE = 500_000;

/**
 * The encode's bitrate: the source's video bitrate (its overall rate less the audio's) scaled by
 * what H.264 needs more, never above the rung's cap nor under the floor; the cap when unknown.
 */
function encodeBitrate(f: RenditionFacts, cap: number): number {
  if (f.bitrate === null || f.videoCodec === null) return cap;
  const video = f.bitrate - (f.audioCodec === null ? 0 : AUDIO_BITRATE);
  const need = H264_NEED[f.videoCodec] ?? OTHER_NEED;
  return Math.min(cap, Math.max(MIN_BITRATE, Math.round(video * need)));
}

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
  maxShort: number,
): SessionPlan {
  // Original keeps the source's size; either way no taller than the server's maximum.
  const asked = r.quality === "original" ? Math.min(f.width, f.height) : Number(r.quality);
  const size = outputSize(f.width, f.height, Math.min(asked, maxShort));
  const level = h264Level(size.width, size.height);
  const bitrate = encodeBitrate(f, rungFor(Math.min(size.width, size.height)).bitrate);
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

/**
 * The plan for a request. `maxShort` is the tallest encode the server makes, on the short side
 * (`UROBOROS_TRANSCODE_MAX_HEIGHT`): Original encodes at the source's size up to it, and a rung
 * above it is brought down to it. A remux copies the source at its own size.
 */
export function planSession(
  f: RenditionFacts,
  r: PlanRequest,
  maxShort: number = MAX_SHORT,
): SessionPlan {
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
    return encodePlan({ ...f, width, height }, r, a, copyable, maxShort);
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
