/**
 * What this browser plays (docs/transcoding.md): the original file as it is (direct play), and,
 * for a playback session, which of its codecs it decodes from fragmented MP4 (so a session can
 * copy them rather than transcode). Asked with the file's exact RFC 6381 codec strings.
 */

interface FileFacts {
  /** The file's extension. */
  container: string | null;
  /** The server's RFC 6381 strings for the file's streams. */
  videoCodecs: string | null;
  audioCodecs: string | null;
}

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
const HLS = "application/vnd.apple.mpegurl";

/** The file's MIME type with its codecs, for `canPlayType`; null when no browser could play it. */
export function originalType(f: FileFacts): string | null {
  const types = f.container === null ? undefined : CONTAINERS[f.container.toLowerCase()];
  if (types === undefined || (f.videoCodecs === null && f.audioCodecs === null)) return null;
  const type = f.videoCodecs === null ? types[1] : types[0];
  if (type === null) return null;
  if (BARE.has(type)) return type;
  const codecs = [f.videoCodecs, f.audioCodecs].filter((c): c is string => c !== null).join(", ");
  return `${type}; codecs="${codecs}"`;
}

const element = (): HTMLVideoElement => document.createElement("video");

/** Whether this browser says it can play the file (`maybe` or `probably`). */
export function canPlayOriginal(f: FileFacts, probe: HTMLVideoElement = element()): boolean {
  const type = originalType(f);
  return type !== null && probe.canPlayType(type) !== "";
}

/**
 * Whether the browser plays HLS itself: Apple's own HLS (Safari, iOS, told by its AirPlay API), or
 * any browser's where there is no MSE. Chrome and Android claim HLS too, but where MSE is they get
 * hls.js, as every other browser with MSE does, rather than Chrome's newer player of its own.
 */
export function hasNativeHls(probe: HTMLVideoElement = element()): boolean {
  if (probe.canPlayType(HLS) === "") return false;
  return (
    typeof MediaSource === "undefined" || "WebKitPlaybackTargetAvailabilityEvent" in globalThis
  );
}

/** Whether a codec plays from fragmented MP4 here: natively in HLS, or through MSE. */
function decodes(codecs: string | null, kind: "video" | "audio", probe: HTMLVideoElement): boolean {
  if (codecs === null) return false;
  const type = `${kind}/mp4; codecs="${codecs}"`;
  if (hasNativeHls(probe)) return probe.canPlayType(type) !== "";
  return typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type);
}

/** What a session may copy for this browser (the rest it transcodes). */
export function capabilities(
  f: FileFacts,
  probe: HTMLVideoElement = element(),
): { copyVideo: boolean; copyAudio: boolean } {
  return {
    copyVideo: decodes(f.videoCodecs, "video", probe),
    copyAudio: decodes(f.audioCodecs, "audio", probe),
  };
}
