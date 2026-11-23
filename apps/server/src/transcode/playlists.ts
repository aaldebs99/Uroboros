import type { Selectable } from "kysely";
import type { TranscodeMode, TranscodesTable } from "../db/schema.ts";

/** A rough peak bitrate per mode, which the multivariant playlist must state. */
const BANDWIDTH: Record<TranscodeMode, number> = {
  encode: 5_000_000,
  remux: 5_000_000,
  audio: 200_000,
};

export type TranscodeRow = Selectable<TranscodesTable>;

/**
 * The one-variant multivariant playlist Video.js's HLS engine needs (it reads only those, with
 * `CODECS`), over the current attempt's media playlist.
 */
export function masterPlaylist(
  row: TranscodeRow & { mode: TranscodeMode; codecs: string },
): string {
  const attrs = [
    `BANDWIDTH=${String(BANDWIDTH[row.mode])}`,
    `CODECS="${row.codecs}"`,
    ...(row.resolution === null ? [] : [`RESOLUTION=${row.resolution}`]),
  ];
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-STREAM-INF:${attrs.join(",")}`,
    `${String(row.attempt)}/index.m3u8`,
    "",
  ].join("\n");
}
