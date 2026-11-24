/** A session's HLS playlists (docs/transcoding.md): one variant, and a VOD list of every segment. */

export interface MasterOptions {
  /** Peak bits per second (the video cap plus the audio). */
  bandwidth: number;
  /** RFC 6381 strings of what the segments carry: no audio codec for a silent video. */
  codecs: readonly string[];
  resolution: { width: number; height: number } | null;
  /** The media playlist's URL, relative to the master playlist. */
  media: string;
}

/** The one-variant multivariant playlist Video.js's HLS engine needs (it reads CODECS). */
export function masterPlaylist(o: MasterOptions): string {
  const attrs = [
    `BANDWIDTH=${String(o.bandwidth)}`,
    `CODECS="${o.codecs.join(",")}"`,
    ...(o.resolution === null
      ? []
      : [`RESOLUTION=${String(o.resolution.width)}x${String(o.resolution.height)}`]),
  ];
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-STREAM-INF:${attrs.join(",")}`,
    o.media,
    "",
  ].join("\n");
}

export interface MediaUrls {
  init: string;
  segment: (index: number) => string;
}

/**
 * The whole video as a VOD media playlist, ended, from the first request: segments not made yet
 * are made when asked for, so the player sees the full duration and can seek anywhere.
 */
export function mediaPlaylist(boundaries: readonly number[], urls: MediaUrls): string {
  const durations = boundaries.slice(1).map((end, i) => end - (boundaries[i] as number));
  const target = Math.max(1, Math.ceil(Math.max(...durations, 0) - 0.001));
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${String(target)}`,
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-MAP:URI="${urls.init}"`,
    ...durations.flatMap((d, i) => [`#EXTINF:${d.toFixed(6)},`, urls.segment(i)]),
    "#EXT-X-ENDLIST",
    "",
  ].join("\n");
}
