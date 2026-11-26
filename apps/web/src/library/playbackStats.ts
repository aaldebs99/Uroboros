import type {
  PlaybackEncoder,
  PlaybackMode,
  PlaybackReason,
  PlaybackSession,
} from "@uroboros/contract";

/**
 * The words of the player's Stats panel (docs/transcoding.md): how a video plays, what its file is,
 * what a session sends, and what the browser makes of it. Pure, so each line is tested alone.
 */

const ENCODERS: Record<PlaybackEncoder, string | null> = {
  copy: null,
  libx264: "CPU",
  nvenc: "NVIDIA GPU",
  vaapi: "GPU (VA-API)",
};

const CODECS: Record<string, string> = {
  h264: "H.264",
  hevc: "HEVC",
  vp9: "VP9",
  vp8: "VP8",
  av1: "AV1",
};

/** Why, in a few words, for an encode; null when the line says enough. */
function why(reason: PlaybackReason, videoCodec: string | null): string | null {
  const reasons: Record<PlaybackReason, string | null> = {
    picked: null,
    container: null,
    audio_unsupported: "converting the audio",
    video_unsupported: `this browser can't play ${CODECS[videoCodec ?? ""] ?? "this video"}`,
    video_not_copyable: "its format can't be streamed as it is",
  };
  return reasons[reason];
}

/** The rung a size is, by its short side (a vertical video's 720p is 720 wide). */
const rung = (s: PlaybackSession) =>
  s.width === null || s.height === null ? "" : `${String(Math.min(s.width, s.height))}p`;

/** How a video plays: direct play, a direct stream, or a transcode and on what. */
export function statusText(s: PlaybackSession | null, videoCodec: string | null): string {
  if (s === null) return "Direct play";
  const reason = why(s.reason, videoCodec);
  const encoder = s.encoder === null ? null : ENCODERS[s.encoder];
  const modes: Record<PlaybackMode, (string | null)[]> = {
    remux: ["Direct stream", reason],
    audio: [s.reason === "audio_unsupported" ? "Converting the audio" : "Direct stream"],
    encode: [`Transcoding to ${rung(s)}`, encoder, reason],
  };
  return modes[s.mode].filter((part): part is string => part !== null).join(" · ");
}

const THREE = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });

/** Bits per second, in Mb/s from one up and in kb/s below. */
export function bitrateText(bps: number): string {
  return bps >= 1_000_000 ? `${THREE.format(bps / 1e6)} Mb/s` : `${THREE.format(bps / 1e3)} kb/s`;
}

/** Bytes, in MB from one up and in kB below. */
const bytesText = (bytes: number) =>
  bytes >= 1_000_000 ? `${THREE.format(bytes / 1e6)} MB` : `${THREE.format(bytes / 1e3)} kB`;

/** RFC 6381 codec strings by their first part, as people call them. */
const CODEC_NAMES: Record<string, string> = {
  av01: "AV1",
  vp09: "VP9",
  vp9: "VP9",
  vp08: "VP8",
  vp8: "VP8",
  avc1: "H.264",
  avc3: "H.264",
  hev1: "HEVC",
  hvc1: "HEVC",
  mp4a: "AAC",
  opus: "Opus",
  flac: "FLAC",
  vorbis: "Vorbis",
  "ac-3": "AC-3",
  "ec-3": "E-AC-3",
  mp3: "MP3",
};

/** A codec string's name: `av01.0.13M.08` is AV1; an unknown one is its first part. */
export function codecName(codecs: string): string {
  const head = codecs.split(".")[0] ?? codecs;
  // MPEG audio in MP4 is mp4a too: layer 3 is MP3.
  if (/^mp4a\.(?:69|6b)$/i.test(codecs)) return "MP3";
  return CODEC_NAMES[head.toLowerCase()] ?? head;
}

const CONTAINERS: Record<string, string> = { webm: "WebM", m4a: "M4A" };

const size = (w: number | null, h: number | null) =>
  w === null || h === null ? null : `${String(w)}×${String(h)}`;

/** What the panel needs of the item's file. */
export interface SourceFacts {
  videoCodecs: string | null;
  audioCodecs: string | null;
  container: string | null;
  width: number | null;
  height: number | null;
  sizeBytes?: number | null;
  duration: number | null;
}

/** The file: its codecs, container and size, and its bitrate when its size and length are known. */
export function sourceLine(f: SourceFacts): string {
  const bitrate =
    f.sizeBytes != null && f.duration !== null && f.duration > 0
      ? bitrateText((f.sizeBytes * 8) / f.duration)
      : null;
  const container =
    f.container === null ? null : (CONTAINERS[f.container] ?? f.container.toUpperCase());
  return [
    f.videoCodecs === null ? null : codecName(f.videoCodecs),
    f.audioCodecs === null ? null : codecName(f.audioCodecs),
    container,
    size(f.width, f.height),
    bitrate,
  ]
    .filter((p): p is string => p !== null)
    .join(" · ");
}

/** What a session sends: an encode's size and target bitrate, the video copied, or audio alone. */
export function outputLine(s: PlaybackSession | null): string | null {
  if (s === null) return null;
  const parts: Record<PlaybackMode, (string | null)[]> = {
    encode: [
      "H.264",
      size(s.width, s.height),
      s.bitrate === null ? null : `${bitrateText(s.bitrate)} target`,
    ],
    remux: ["Video copied", size(s.width, s.height)],
    audio: ["Audio only"],
  };
  return parts[s.mode].filter((p): p is string => p !== null).join(" · ");
}

const RATIO = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** The player's size on screen and its pixel ratio, and the picture the browser decodes. */
export function viewportLine(v: {
  width: number;
  height: number;
  ratio: number;
  videoWidth: number;
  videoHeight: number;
}): string {
  const shown = `${String(v.width)}×${String(v.height)} ×${RATIO.format(v.ratio)}`;
  return v.videoWidth > 0 && v.videoHeight > 0
    ? `${shown} · decoding ${String(v.videoWidth)}×${String(v.videoHeight)}`
    : shown;
}

const COUNT = new Intl.NumberFormat("en-US");

/** Frames dropped of those decoded, when the browser counts them. */
export function framesLine(
  q: Pick<VideoPlaybackQuality, "droppedVideoFrames" | "totalVideoFrames"> | null,
): string | null {
  if (q === null) return null;
  return `${COUNT.format(q.droppedVideoFrames)} dropped of ${COUNT.format(q.totalVideoFrames)}`;
}

/** Seconds buffered past `t`, in the buffered range `t` is in; none outside one. */
export function bufferAhead(
  buffered: Pick<TimeRanges, "length" | "start" | "end">,
  t: number,
): number {
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= t && t <= buffered.end(i)) return buffered.end(i) - t;
  }
  return 0;
}

/** A session segment's file name, as the player fetches it. */
const SEGMENT = /\/seg-\d+\.m4s(?:[?#]|$)/;

/** What the panel needs of a Resource Timing entry. */
export interface FetchTiming {
  name: string;
  encodedBodySize: number;
  requestStart: number;
  responseEnd: number;
}

/**
 * The newest session segment the player fetched: its bytes and the seconds it took to come. With
 * `session` (its URL), that session's alone: a session it replaced fetched segments too.
 */
export function lastSegment(
  entries: readonly FetchTiming[],
  session?: string,
): { bytes: number; seconds: number } | null {
  const seg = entries.findLast(
    (e) => SEGMENT.test(e.name) && (session === undefined || e.name.includes(`${session}/seg-`)),
  );
  if (seg === undefined) return null;
  return { bytes: seg.encodedBodySize, seconds: (seg.responseEnd - seg.requestStart) / 1000 };
}

const SECONDS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** The newest segment's size, how long it took, and so the connection's speed. */
export function networkLine(seg: { bytes: number; seconds: number } | null): string | null {
  if (seg === null || seg.seconds <= 0) return null;
  const speed = bitrateText((seg.bytes * 8) / seg.seconds);
  return `last segment ${bytesText(seg.bytes)} in ${SECONDS.format(seg.seconds)} s (${speed})`;
}
