import { z } from "@hono/zod-openapi";
import { LibraryEntry, SponsorSegment } from "./downloads.ts";
import { PlaybackFacts } from "./playback.ts";

export const MAX_TAGS = 20;
export const LIBRARY_PAGE_SIZE = 60;
/** A search (`q`) is 3–200 characters, at most 8 words or "quoted phrases" (docs/library.md). */
export const SEARCH_MIN_CHARS = 3;
export const SEARCH_MAX_CHARS = 200;
export const SEARCH_MAX_TERMS = 8;

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

/**
 * Library › Videos or Library › Audio: whether the file has a picture (a video stream; cover art
 * is not one), or sound alone (docs/library.md "Videos and audio").
 */
export const LibraryKind = z.enum(["video", "audio"]).openapi("LibraryKind");
export type LibraryKind = z.infer<typeof LibraryKind>;

/** Where a search matched that the tile doesn't show already (docs/library.md "Search"). */
export const SearchMatchSource = z
  .enum(["chapter", "description", "captions"])
  .openapi("SearchMatchSource");
export type SearchMatchSource = z.infer<typeof SearchMatchSource>;

/** A short line around the match, its terms marked. */
export const SearchSnippet = z
  .array(z.object({ text: z.string(), mark: z.boolean() }))
  .max(64)
  .openapi("SearchSnippet");
export type SearchSnippet = z.infer<typeof SearchSnippet>;

export const SearchMatch = z
  .object({
    in: SearchMatchSource,
    snippet: SearchSnippet,
    /** Where it plays from, in seconds: the chapter's start, or the caption line's; null otherwise. */
    start: z.number().min(0).nullable(),
  })
  .openapi("SearchMatch");
export type SearchMatch = z.infer<typeof SearchMatch>;

/**
 * A library page's entry: with `q`, also where it matched (null when only its title or channel
 * did, which the tile shows).
 */
export const LibraryPageEntry = LibraryEntry.extend({
  match: SearchMatch.nullable().optional(),
}).openapi("LibraryPageEntry");
export type LibraryPageEntry = z.infer<typeof LibraryPageEntry>;

export const LibraryPage = z
  .object({
    entries: z.array(LibraryPageEntry),
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

/** A video's own details, its site's (or its uploader's), under the caller's own. */
export const OriginalDetails = z
  .object({
    title: z.string(),
    description: z.string().nullable(),
    channel: z.string().nullable(),
  })
  .openapi("OriginalDetails");
export type OriginalDetails = z.infer<typeof OriginalDetails>;

/** One entry with what its page and player need. */
export const LibraryItem = LibraryEntry.extend({
  description: z.string().nullable(),
  chapters: z.array(Chapter),
  /** The file's SponsorBlock segments the caller shows or skips (Settings › SponsorBlock). */
  sponsorSegments: z.array(SponsorSegment),
  /**
   * SponsorBlock's highlight, in seconds on the file's timeline: the moment people marked as what
   * the video is for; null when it has none.
   */
  sponsorHighlight: z.number().nullable(),
  /**
   * The caller's own downloaded YouTube video: they may fetch its SponsorBlock segments again
   * (`POST /api/library/{id}/skip-segments/refetch`).
   */
  sponsorSegmentsRefetchable: z.boolean(),
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
  /** The caller uploaded it and may edit its details and thumbnail, for everyone (docs/uploads.md). */
  editable: z.boolean(),
  /**
   * Any other video of the caller's own: they may give it details of their own, for them alone
   * (docs/library.md#your-own-details).
   */
  personalEditable: z.boolean().default(false),
  /** The caller's own details are showing; `original` holds the ones they replaced. */
  edited: z.boolean().default(false),
  original: OriginalDetails.nullable().default(null),
  ...PlaybackFacts.shape,
}).openapi("LibraryItem");
export type LibraryItem = z.infer<typeof LibraryItem>;

/**
 * A short-lived link that saves one file without the session cookie (docs/downloads.md#saving-a-file):
 * the installed iPhone app hands it to Safari, which doesn't have the app's cookies.
 */
export const SaveLink = z
  .object({
    /** Same-origin, under `/api/public/saves/`; it works for any number of requests until it expires. */
    url: z.string(),
    expiresAt: z.iso.datetime(),
  })
  .openapi("SaveLink");
export type SaveLink = z.infer<typeof SaveLink>;

/**
 * Asks for a save link, optionally with its token chosen by the app (32 random bytes, base64url),
 * so the app knows the link inside the tap and can hand it to Safari at once.
 */
export const SaveLinkBody = z
  .object({
    token: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
  })
  .openapi("SaveLinkBody");
export type SaveLinkBody = z.infer<typeof SaveLinkBody>;

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
