import { h264Level } from "./ladder.ts";

/**
 * RFC 6381 codec strings for a stored file's streams, from ffprobe's facts, so the web app can ask
 * the browser about the file itself (`canPlayType`, `MediaSource.isTypeSupported`) and a playlist
 * can state the codecs of what it serves.
 */

export interface VideoFacts {
  codec: string | null;
  profile: string | null;
  /** ffprobe's level: H.264 ×10 (40 is 4.0), HEVC ×30 (120 is 4.0), AV1 the seq_level_idx. */
  level: number | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
}

export interface AudioFacts {
  codec: string | null;
  profile: string | null;
}

/** Codecs fragmented MP4 carries as they are, so a session can copy them (remux). */
export const COPYABLE_VIDEO: ReadonlySet<string> = new Set(["h264", "hevc", "vp9", "av1"]);
export const COPYABLE_AUDIO: ReadonlySet<string> = new Set([
  "aac",
  "opus",
  "flac",
  "mp3",
  "ac3",
  "eac3",
  "alac",
]);

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
const pad2 = (n: number) => String(n).padStart(2, "0");
const depth = (pixFmt: string | null) => (/1[02]le$|p010/.test(pixFmt ?? "") ? 10 : 8);
const samples = (v: VideoFacts) => (v.width ?? 0) * (v.height ?? 0);
const fast = (v: VideoFacts) => (v.fps ?? 30) > 30;

const AVC_PROFILES: Record<string, string> = {
  "Constrained Baseline": "42e0",
  Baseline: "4200",
  Main: "4d00",
  Extended: "5800",
  High: "6400",
  "High 10": "6e00",
  "High 4:2:2": "7a00",
  "High 4:4:4 Predictive": "f400",
};

function avc(v: VideoFacts): string {
  const profile = AVC_PROFILES[v.profile ?? ""] ?? "6400";
  const level = v.level ?? h264Level(v.width ?? 1920, v.height ?? 1080).idc;
  return `avc1.${profile}${hex2(level)}`;
}

function hevc(v: VideoFacts): string {
  const main10 = v.profile === "Main 10" || depth(v.pixFmt) === 10;
  return `hvc1.${main10 ? "2.4" : "1.6"}.L${String(v.level ?? 120)}.B0`;
}

/** VP9 levels by luma picture size (and rate): 3.1, 4.0/4.1, 5.0/5.1, 6.0. */
function vp9Level(v: VideoFacts): number {
  const size = samples(v);
  if (size <= 552_960) return size <= 245_760 ? 21 : 30;
  if (size <= 983_040) return 31;
  if (size <= 2_228_224) return fast(v) ? 41 : 40;
  if (size <= 8_912_896) return fast(v) ? 51 : 50;
  return 60;
}

function vp9(v: VideoFacts): string {
  const profile = v.profile === "Profile 2" || depth(v.pixFmt) === 10 ? 2 : 0;
  return `vp09.${pad2(profile)}.${pad2(vp9Level(v))}.${pad2(depth(v.pixFmt))}`;
}

/** AV1 seq_level_idx by picture size (and rate): 3.0, 3.1, 4.0/4.1, 5.0/5.1, 6.0. */
function av1Level(v: VideoFacts): number {
  const size = samples(v);
  if (size <= 665_856) return size <= 278_784 ? 1 : 4;
  if (size <= 1_065_024) return 5;
  if (size <= 2_359_296) return fast(v) ? 9 : 8;
  if (size <= 8_912_896) return fast(v) ? 13 : 12;
  return 16;
}

function av1(v: VideoFacts): string {
  return `av01.0.${pad2(v.level ?? av1Level(v))}M.${pad2(depth(v.pixFmt))}`;
}

/** The video stream's codec string, or null for a codec no browser plays from MP4 or WebM. */
export function videoCodecString(v: VideoFacts): string | null {
  switch (v.codec) {
    case "h264":
      return avc(v);
    case "hevc":
      return hevc(v);
    case "vp9":
      return vp9(v);
    case "av1":
      return av1(v);
    case "vp8":
      return "vp8";
    default:
      return null;
  }
}

const AAC_PROFILES: Record<string, string> = { "HE-AAC": "mp4a.40.5", "HE-AACv2": "mp4a.40.29" };
const AUDIO: Record<string, string> = {
  opus: "opus",
  mp3: "mp4a.6B",
  ac3: "ac-3",
  eac3: "ec-3",
  flac: "flac",
  vorbis: "vorbis",
  alac: "alac",
};

/** The audio stream's codec string, or null for one no browser plays (raw PCM, DTS…). */
export function audioCodecString(a: AudioFacts): string | null {
  if (a.codec === "aac") return AAC_PROFILES[a.profile ?? ""] ?? "mp4a.40.2";
  return AUDIO[a.codec ?? ""] ?? null;
}
