/** Can this browser play an entry's file as it is? (docs/transcoding.md) */

interface FileFacts {
  /** The file's extension. */
  container: string | null;
  /** ffprobe's codec names. */
  videoCodec: string | null;
  audioCodec: string | null;
}

/** RFC 6381 codec strings for ffprobe's names (a representative profile and level). */
const VIDEO: Record<string, string> = {
  h264: "avc1.640028",
  hevc: "hvc1.1.6.L120.90",
  vp9: "vp09.00.40.08",
  vp8: "vp8",
  av1: "av01.0.08M.08",
};
const AUDIO: Record<string, string> = {
  aac: "mp4a.40.2",
  opus: "opus",
  mp3: "mp3",
  vorbis: "vorbis",
  flac: "flac",
};

/** Containers a browser may play, as [video type, audio-only type]; MKV is not among them. */
const CONTAINERS: Record<string, readonly [string | null, string]> = {
  mp4: ["video/mp4", "audio/mp4"],
  m4v: ["video/mp4", "audio/mp4"],
  mov: ["video/mp4", "audio/mp4"],
  webm: ["video/webm", "audio/webm"],
  m4a: [null, "audio/mp4"],
  opus: [null, "audio/ogg"],
  ogg: [null, "audio/ogg"],
  mp3: [null, "audio/mpeg"],
  flac: [null, "audio/flac"],
};
/** Types whose codec is implied, which take no `codecs` parameter. */
const BARE = new Set(["audio/mpeg", "audio/flac"]);

/** The file's MIME type with its codecs, for `canPlayType`; null when no browser could play it. */
export function codecsFor(f: FileFacts): string | null {
  const types = f.container === null ? undefined : CONTAINERS[f.container.toLowerCase()];
  if (types === undefined) return null;
  const video = f.videoCodec === null ? null : (VIDEO[f.videoCodec] ?? undefined);
  const audio = f.audioCodec === null ? null : (AUDIO[f.audioCodec] ?? undefined);
  if (video === undefined || audio === undefined || (video === null && audio === null)) return null;
  const type = video === null ? types[1] : types[0];
  if (type === null) return null;
  if (BARE.has(type)) return type;
  const codecs = [video, audio].filter((c): c is string => c !== null).join(", ");
  return `${type}; codecs="${codecs}"`;
}

const element = (): HTMLVideoElement => document.createElement("video");

/** Whether this browser says it can play the file (`maybe` or `probably`). */
export function canPlayOriginal(f: FileFacts, probe: HTMLVideoElement = element()): boolean {
  const type = codecsFor(f);
  return type !== null && probe.canPlayType(type) !== "";
}

/** Safari and iOS play HLS themselves, including a playlist that is still growing. */
export function hasNativeHls(probe: HTMLVideoElement = element()): boolean {
  return probe.canPlayType("application/vnd.apple.mpegurl") !== "";
}
