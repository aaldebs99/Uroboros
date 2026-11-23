import type { HlsMode, MediaInfo } from "@uroboros/ytdlp";
import { TRANSCODE } from "./settings.ts";

/** What a copy of this file will be, and what the multivariant playlist says about it. */
export interface CopyChoice {
  mode: HlsMode;
  copyAudio: boolean;
  hdr: boolean;
  /** RFC 6381, for the playlist's CODECS. */
  codecs: string;
  /** `WxH` of the copy, or null without video. */
  resolution: string | null;
}

const EIGHT_BIT = new Set(["yuv420p", "yuvj420p"]);
const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);
const AVC_AAC = "avc1.640028,mp4a.40.2";
const AAC = "mp4a.40.2";

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The output size: scaled down to at most 1080 lines (never up), aspect kept, both even. */
function outputSize(w: number | null, h: number | null, scale: boolean): string | null {
  if (w === null || h === null || h === 0) return null;
  if (!scale || h <= TRANSCODE.maxHeight) return `${String(w)}x${String(h)}`;
  return `${String(even((w * TRANSCODE.maxHeight) / h))}x${String(TRANSCODE.maxHeight)}`;
}

/**
 * `audio` without a video stream; `remux` for 8-bit H.264, whose video can be copied; else
 * `encode`, tone-mapping an HDR (PQ or HLG) source. AAC audio is copied, anything else converted.
 */
export function chooseMode(info: MediaInfo): CopyChoice {
  const video = info.streams.find((s) => s.type === "video");
  const audio = info.streams.find((s) => s.type === "audio");
  const copyAudio = audio?.codec === "aac";
  if (video === undefined) {
    return { mode: "audio", copyAudio, hdr: false, codecs: AAC, resolution: null };
  }
  const remux = video.codec === "h264" && EIGHT_BIT.has(video.pixFmt ?? "");
  return {
    mode: remux ? "remux" : "encode",
    copyAudio,
    hdr: !remux && HDR_TRANSFERS.has(video.colorTransfer ?? ""),
    codecs: AVC_AAC,
    resolution: outputSize(video.width, video.height, !remux),
  };
}
