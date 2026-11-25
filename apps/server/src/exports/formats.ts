/**
 * The audio containers a copy without sponsors can be written as (docs/transcoding.md), by file
 * extension: those the export job has a muxer for (`audioMuxerFor` in @uroboros/ytdlp, which the
 * HTTP side may not import; `formats.test.ts` holds the two lists together).
 */
export const AUDIO_COPY_FORMATS: ReadonlySet<string> = new Set([
  "mp3",
  "opus",
  "ogg",
  "oga",
  "webm",
  "m4a",
  "mp4",
  "mka",
  "flac",
  "wav",
  "aac",
]);

/**
 * What a copy of a file is made as: MP4 for a video (re-encoded as a playback session is), an
 * audio file's own container for audio; null for a container a copy can't write.
 */
export function exportFormatFor(r: {
  video_codec: string | null;
  container: string | null;
}): string | null {
  if (r.video_codec !== null) return "mp4";
  const ext = (r.container ?? "").toLowerCase();
  return AUDIO_COPY_FORMATS.has(ext) ? ext : null;
}
