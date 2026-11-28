import type { FormatProfile, VideoCodec } from "@uroboros/contract";

/**
 * A format profile's plain choices (docs/downloads.md#format-profiles) and the yt-dlp format
 * selectors they stand for. The server stores and runs the selector; these are how the form writes
 * and reads one, and how the list says it in words.
 */

/** A choice of a dropdown: the value saved, and the words shown. */
export interface Choice<T extends string> {
  value: T;
  label: string;
}

export const QUALITIES = [
  { value: "best", label: "Best available" },
  { value: "2160", label: "Up to 4K (2160p)" },
  { value: "1440", label: "Up to 1440p" },
  { value: "1080", label: "Up to 1080p" },
  { value: "720", label: "Up to 720p" },
  { value: "480", label: "Up to 480p" },
  { value: "360", label: "Up to 360p" },
] as const satisfies readonly Choice<string>[];
export type Quality = (typeof QUALITIES)[number]["value"];

/** The best video joined with the best audio, else the best single file, no taller than `q`. */
export function selectorFor(q: Quality): string {
  return q === "best" ? "bv*+ba/b" : `bv*[height<=${q}]+ba/b[height<=${q}]`;
}

/** The quality a selector stands for, or null for one written by hand. */
export function qualityOf(selector: string): Quality | null {
  const trimmed = selector.trim();
  return QUALITIES.find((q) => selectorFor(q.value) === trimmed)?.value ?? null;
}

/** "Any" is the empty value: no preference, yt-dlp's own order. */
export const CODECS: readonly Choice<VideoCodec | "">[] = [
  { value: "", label: "Any" },
  { value: "av1", label: "AV1" },
  { value: "vp9", label: "VP9" },
  { value: "h265", label: "H.265 (HEVC)" },
  { value: "h264", label: "H.264 (AVC)" },
];

/** "Any" is the empty value: yt-dlp picks the container. */
export const CONTAINERS: readonly Choice<string>[] = [
  { value: "", label: "Any" },
  { value: "mp4", label: "MP4" },
  { value: "mkv", label: "MKV" },
  { value: "webm", label: "WebM" },
];

/** The only video codecs a WebM file holds. */
export const WEBM_CODECS: ReadonlySet<string> = new Set<VideoCodec>(["av1", "vp9"]);

export const AUDIO_FORMATS: readonly Choice<string>[] = [
  { value: "opus", label: "Opus" },
  { value: "m4a", label: "M4A (AAC)" },
  { value: "mp3", label: "MP3" },
  { value: "flac", label: "FLAC" },
  { value: "wav", label: "WAV" },
];

/**
 * The selector the form writes for an audio format, the built-in audio profiles' own: Opus or M4A
 * as the site serves it when it has one (no conversion), stereo first, else the best stereo audio,
 * converted. yt-dlp ranks a format's channels above its codec, so a bare `ba/b` takes a 5.1 track
 * where one is offered (YouTube's AAC 5.1), converting it into Opus or downmixing it into MP3. The
 * lossless formats, which hold surround, keep the best audio.
 */
const AUDIO_SELECTORS: Readonly<Record<string, string>> = {
  opus: "ba[acodec=opus]/ba[audio_channels<=2]/ba/b",
  m4a: "ba[ext=m4a][audio_channels<=2]/ba[ext=m4a]/ba/b",
  mp3: "ba[audio_channels<=2]/ba/b",
};

export function audioSelectorFor(format: string): string {
  return AUDIO_SELECTORS[format] ?? "ba/b";
}

/**
 * Whether an audio profile's selector is the one the form writes for its audio format. Any other
 * (written by hand, or another format's) stays as it is, so saving never changes the profile's
 * revision behind the person's back.
 */
export function isStandardAudioSelector(selector: string, format: string): boolean {
  return selector.trim() === audioSelectorFor(format);
}

/** A value's words in a list, or the value itself when the list doesn't have it. */
export function labelOf(list: readonly Choice<string>[], value: string): string {
  return list.find((c) => c.value === value)?.label ?? value;
}

/**
 * A profile in a line of words: the quality (or a hand-written selector as it is), the codec and the
 * container, or the audio format; then the extra arguments.
 */
export function describeProfile(p: FormatProfile): string {
  const extra = p.extraArgs.join(" ");
  const shape = p.audioOnly
    ? [
        "Audio",
        labelOf(AUDIO_FORMATS, p.audioFormat ?? "?"),
        ...(isStandardAudioSelector(p.format, p.audioFormat ?? "") ? [] : [p.format]),
      ]
    : [
        labelOf(QUALITIES, qualityOf(p.format) ?? p.format),
        p.videoCodec === null ? "any codec" : labelOf(CODECS, p.videoCodec),
        p.mergeFormat === null ? "any container" : labelOf(CONTAINERS, p.mergeFormat),
      ];
  return [...shape, ...(extra === "" ? [] : [extra])].join(" · ");
}
