const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4a: "audio/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  jpg: "image/jpeg",
  webp: "image/webp",
  png: "image/png",
  json: "application/json",
};

/** The media type for a file extension (without the dot). */
export const contentTypeOf = (ext: string): string =>
  CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
