import { z } from "@hono/zod-openapi";
import { LibraryEntry } from "./downloads.ts";

export const MAX_TAGS = 20;
export const LIBRARY_PAGE_SIZE = 60;

/** A tag: trimmed, lower-cased, 1–32 characters. */
export const Tag = z.string().trim().toLowerCase().min(1).max(32).openapi("Tag");

export const Chapter = z
  .object({ start: z.number(), end: z.number().nullable(), title: z.string().nullable() })
  .openapi("Chapter");
export type Chapter = z.infer<typeof Chapter>;

export const LibrarySort = z
  .enum(["added", "uploaded", "title", "duration", "position", "relevance"])
  .openapi("LibrarySort");
export type LibrarySort = z.infer<typeof LibrarySort>;

export const LibraryPage = z
  .object({
    entries: z.array(LibraryEntry),
    /** Pass as `cursor` for the next page; null on the last one. */
    nextCursor: z.string().nullable(),
  })
  .openapi("LibraryPage");
export type LibraryPage = z.infer<typeof LibraryPage>;

export const SubtitleTrack = z
  .object({
    id: z.uuid(),
    lang: z.string(),
    name: z.string().nullable(),
    automatic: z.boolean(),
    url: z.string(),
  })
  .openapi("SubtitleTrack");
export type SubtitleTrack = z.infer<typeof SubtitleTrack>;

/** One entry with what its page and player need. */
export const LibraryItem = LibraryEntry.extend({
  description: z.string().nullable(),
  chapters: z.array(Chapter),
  subtitles: z.array(SubtitleTrack),
  /** Inline, range-capable; may redirect to a presigned URL. */
  streamUrl: z.string(),
  webpageUrl: z.string().nullable(),
  /** The caller's YouTube playlists this video is in. */
  sources: z.array(z.object({ id: z.uuid(), title: z.string().nullable() })),
  /** The caller's own (manual) playlists this video is in. */
  playlists: z.array(z.object({ id: z.uuid(), name: z.string() })),
  /** ffprobe's codec names (with the entry's `container`): does this browser play the file? */
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  /** Asks for, and follows, a compatible copy (docs/transcoding.md). */
  playbackUrl: z.string(),
  /** The owner's name when the caller sees it through a share (docs/sharing.md); null for their own. */
  sharedBy: z.string().nullable(),
}).openapi("LibraryItem");
export type LibraryItem = z.infer<typeof LibraryItem>;

/** An entry of the caller's, by id. */
export const EntryRef = z.object({ id: z.uuid() }).openapi("EntryRef");
export type EntryRef = z.infer<typeof EntryRef>;

export const ChannelSummary = z
  .object({
    key: z.string(),
    name: z.string(),
    extractor: z.string(),
    count: z.number().int(),
    latestUpload: z.string().nullable(),
    coverThumbnailUrl: z.string().nullable(),
  })
  .openapi("ChannelSummary");
export type ChannelSummary = z.infer<typeof ChannelSummary>;

export const SourceSummary = z
  .object({
    id: z.uuid(),
    title: z.string().nullable(),
    url: z.string(),
    count: z.number().int(),
    coverThumbnailUrl: z.string().nullable(),
  })
  .openapi("SourceSummary");
export type SourceSummary = z.infer<typeof SourceSummary>;

export const ProgressBody = z
  .object({ position: z.number().min(0), duration: z.number().positive() })
  .openapi("ProgressBody");
export type ProgressBody = z.infer<typeof ProgressBody>;

export const WatchedBody = z.object({ watched: z.boolean() }).openapi("WatchedBody");
export type WatchedBody = z.infer<typeof WatchedBody>;

export const TagsBody = z
  .object({
    tags: z
      .array(Tag)
      .max(MAX_TAGS)
      .transform((tags) => [...new Set(tags)]),
  })
  .openapi("TagsBody");
export type TagsBody = z.infer<typeof TagsBody>;

export const PlaybackState = z
  .enum(["queued", "running", "done", "failed"])
  .openapi("PlaybackState");
export type PlaybackState = z.infer<typeof PlaybackState>;

/** A compatible HLS copy of an entry's file, and how far along it is. */
export const Playback = z
  .object({
    state: PlaybackState,
    /** How it is made, once the job has looked at the file; null while queued. */
    mode: z.enum(["encode", "remux", "audio"]).nullable(),
    /** Segments stored so far (native HLS can start at 2). */
    readySegments: z.number().int(),
    /** 0 to 1, from ffmpeg's progress over the duration. */
    progress: z.number(),
    /** The multivariant playlist to play (valid once there is a mode). */
    masterUrl: z.string(),
    error: z.string().nullable(),
  })
  .openapi("Playback");
export type Playback = z.infer<typeof Playback>;
