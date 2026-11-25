import { mediaInputArgs } from "./ffmpegArgs.ts";

/**
 * A copy of a stored audio file without some of it (its SponsorBlock segments; docs/transcoding.md
 * "Saving without SponsorBlock segments"): each kept range trimmed from the decoded samples and the
 * ranges joined, then encoded again with the source's own codec into its own container, so a cut
 * lands exactly where it should with no click, MP3 stays MP3 and lossless stays lossless. The
 * source's tags come along, its cover where the container takes one, and the chapters given.
 */
export interface AudioExportPlan {
  /** The file's path, or a presigned URL. */
  input: string;
  output: string;
  /** The ranges to keep, in order; a null `end` runs to the end of the file. */
  ranges: readonly { start: number; end: number | null }[];
  /** The audio stream's index in the input. */
  audio: { index: number };
  /** The cover art (an attached picture) stream's index, when there is one. */
  cover: { index: number } | null;
  /** The encoder and its settings (`audioEncoderFor`). */
  encoder: readonly string[];
  /** The output's muxer (`audioMuxerFor`). */
  muxer: string;
  /** An ffmetadata file with the copy's chapters, or null for none. */
  chapters: string | null;
}

/** The source's codec, as ffprobe names it, and how a copy encodes it again. */
const ENCODERS: Record<string, readonly string[]> = {
  mp3: ["-c:a", "libmp3lame", "-q:a", "0"],
  opus: ["-c:a", "libopus", "-b:a", "160k"],
  vorbis: ["-c:a", "libvorbis", "-q:a", "6"],
  aac: ["-c:a", "aac", "-b:a", "256k"],
  flac: ["-c:a", "flac"],
  alac: ["-c:a", "alac"],
  pcm_s16le: ["-c:a", "pcm_s16le"],
  pcm_s24le: ["-c:a", "pcm_s24le"],
  pcm_s32le: ["-c:a", "pcm_s32le"],
  pcm_f32le: ["-c:a", "pcm_f32le"],
};

/** A stored file's extension, and the muxer that writes that container. */
const MUXERS: Record<string, string> = {
  mp3: "mp3",
  opus: "opus",
  ogg: "ogg",
  oga: "ogg",
  webm: "webm",
  m4a: "ipod",
  mp4: "mp4",
  mka: "matroska",
  flac: "flac",
  wav: "wav",
  aac: "adts",
};

/** The muxers that keep a cover as an attached picture. */
const COVERED = new Set(["mp3", "ipod", "mp4", "flac", "matroska"]);

/** How a copy encodes `codec` again, or null for a codec it can't. */
export function audioEncoderFor(codec: string | null): string[] | null {
  const args = codec === null ? undefined : ENCODERS[codec];
  return args === undefined ? null : [...args];
}

/** The muxer for a file with extension `ext`, or null for a container a copy can't write. */
export function audioMuxerFor(ext: string): string | null {
  return MUXERS[ext.toLowerCase()] ?? null;
}

/** Whether `muxer` keeps a cover. */
export const coverFits = (muxer: string): boolean => COVERED.has(muxer);

const t = (s: number) => Math.max(0, s).toFixed(3);

/** The filter graph: the kept ranges trimmed and joined; outputs [a]. */
function audioFilterGraph(p: AudioExportPlan): string {
  const a = `0:${String(p.audio.index)}`;
  const parts = p.ranges.map((r, i) => {
    const end = r.end === null ? "" : `:end=${t(r.end)}`;
    return `[${a}]atrim=start=${t(r.start)}${end},asetpts=PTS-STARTPTS[a${String(i)}]`;
  });
  const joined = p.ranges.map((_, i) => `[a${String(i)}]`).join("");
  return [...parts, `${joined}concat=n=${String(p.ranges.length)}:v=0:a=1[a]`].join(";");
}

/** The whole command line, after the binary. */
export function audioExportArgs(p: AudioExportPlan): string[] {
  const cover = p.cover !== null && coverFits(p.muxer) ? p.cover : null;
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-progress",
    "pipe:1",
    "-nostats",
    ...mediaInputArgs(p.input),
    "-i",
    p.input,
    ...(p.chapters === null ? [] : ["-f", "ffmetadata", "-i", p.chapters]),
    "-filter_complex",
    audioFilterGraph(p),
    "-map",
    "[a]",
    ...p.encoder,
    ...(cover === null
      ? []
      : ["-map", `0:${String(cover.index)}`, "-c:v", "copy", "-disposition:v", "attached_pic"]),
    // The source's tags (artist, album…) stay; its chapters are on the uncut timeline, so they come
    // from the chapters file, remapped, or not at all.
    "-map_metadata",
    "0",
    "-map_chapters",
    p.chapters === null ? "-1" : "1",
    "-f",
    p.muxer,
    "-y",
    p.output,
  ];
}
