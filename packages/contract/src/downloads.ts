import { z } from "@hono/zod-openapi";

/**
 * Why a download or probe failed: every yt-dlp wrapper error kind, plus `storage` for a file that
 * could not be stored and `not_a_feed` for a single video pasted to subscribe to. The web shows a message per kind, so a new kind breaks `tsc` there.
 */
export const DOWNLOAD_ERROR_KINDS = [
  "unavailable",
  "private",
  "geo_blocked",
  "age_restricted",
  "login_required",
  "login_failed",
  "rate_limited",
  "network",
  "unsupported_url",
  "unknown",
  "invalid_url",
  "invalid_arguments",
  "cancelled",
  "timed_out",
  "spawn_failed",
  "invalid_output",
  "storage",
  "not_a_feed",
] as const;
export const DownloadErrorKind = z.enum(DOWNLOAD_ERROR_KINDS).openapi("DownloadErrorKind");
export type DownloadErrorKind = z.infer<typeof DownloadErrorKind>;

export const DownloadState = z
  .enum(["queued", "running", "done", "failed", "cancelled"])
  .openapi("DownloadState");
export type DownloadState = z.infer<typeof DownloadState>;

export const RequestState = z
  .enum(["probing", "choosing", "queued", "failed"])
  .openapi("RequestState");
export type RequestState = z.infer<typeof RequestState>;

const Id = z.uuid();
const ProfileName = z.string().trim().min(1).max(64);
const Word = z.string().regex(/^[a-z0-9]{1,16}$/);

/** SponsorBlock segment categories a profile can cut (yt-dlp's names; `poi_highlight` is a point). */
export const SPONSORBLOCK_CATEGORIES = [
  "sponsor",
  "intro",
  "outro",
  "selfpromo",
  "preview",
  "filler",
  "interaction",
  "music_offtopic",
] as const;
export const SponsorBlockCategory = z.enum(SPONSORBLOCK_CATEGORIES).openapi("SponsorBlockCategory");
export type SponsorBlockCategory = z.infer<typeof SponsorBlockCategory>;
const Categories = z.array(SponsorBlockCategory).max(SPONSORBLOCK_CATEGORIES.length * 2);

/**
 * A SponsorBlock segment the player skips, in seconds on the file's own timeline: a video profile
 * keeps its segments in the file (marked as chapters) rather than cutting them.
 */
export const SkipSegment = z
  .object({ start: z.number(), end: z.number(), category: SponsorBlockCategory })
  .openapi("SkipSegment");
export type SkipSegment = z.infer<typeof SkipSegment>;

/**
 * A yt-dlp preset: a built-in the caller kept, or one of their own; nobody sees another person's.
 * Editing a built-in makes it the caller's own copy, and deleting one hides it, for them alone.
 * `revision` changes whenever the file-shaping arguments do.
 */
export const FormatProfile = z
  .object({
    id: Id,
    name: z.string(),
    format: z.string(),
    mergeFormat: z.string().nullable(),
    audioOnly: z.boolean(),
    audioFormat: z.string().nullable(),
    extraArgs: z.array(z.string()),
    /** Segments cut from the file when it is downloaded. */
    sponsorblockRemove: z.array(SponsorBlockCategory),
    /** A built-in the caller hasn't changed, shared with everyone; false for their own. */
    builtIn: z.boolean(),
    /** The caller's default: their own choice, or else the built-in default. */
    isDefault: z.boolean(),
    revision: z.string(),
  })
  .openapi("FormatProfile");
export type FormatProfile = z.infer<typeof FormatProfile>;

export const NewFormatProfileBody = z
  .object({
    name: ProfileName,
    format: z.string().min(1).max(512),
    mergeFormat: Word.nullable().default(null),
    audioOnly: z.boolean().default(false),
    audioFormat: Word.nullable().default(null),
    extraArgs: z.array(z.string().max(512)).max(64).default([]),
    sponsorblockRemove: Categories.default([]),
  })
  .openapi("NewFormatProfileBody");
export type NewFormatProfileBody = z.infer<typeof NewFormatProfileBody>;

export const FormatProfilePatch = z
  .object({
    name: ProfileName.optional(),
    format: z.string().min(1).max(512).optional(),
    mergeFormat: Word.nullable().optional(),
    audioOnly: z.boolean().optional(),
    audioFormat: Word.nullable().optional(),
    extraArgs: z.array(z.string().max(512)).max(64).optional(),
    sponsorblockRemove: Categories.optional(),
  })
  .openapi("FormatProfilePatch");
export type FormatProfilePatch = z.infer<typeof FormatProfilePatch>;

/** Which visible profile the caller downloads with when they pick none. */
export const DefaultProfileBody = z.object({ profileId: Id }).openapi("DefaultProfileBody");
export type DefaultProfileBody = z.infer<typeof DefaultProfileBody>;

export const NewDownloadBody = z
  .object({
    url: z.url({ protocol: /^https?$/ }).max(2048),
    /** Omitted: the default profile. */
    profileId: Id.optional(),
    /**
     * `subscribe` (Subscriptions › Add subscription): the link is for a subscription, so a single
     * video fails as `not_a_feed` instead of being downloaded. Omitted: `download`.
     */
    intent: z.enum(["download", "subscribe"]).optional(),
  })
  .openapi("NewDownloadBody");
export type NewDownloadBody = z.infer<typeof NewDownloadBody>;

/** How many videos a YouTube search lists (`POST /api/downloads/search`). */
export const YOUTUBE_SEARCH_RESULTS = 10;

/**
 * Search YouTube (the Ctrl+K palette's "Search YouTube for …"): a worker lists the top
 * `YOUTUBE_SEARCH_RESULTS` videos as a preview whose entries download one by one.
 */
export const NewSearchBody = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !/\p{Cc}/u.test(value), "no control characters"),
  })
  .openapi("NewSearchBody");
export type NewSearchBody = z.infer<typeof NewSearchBody>;

/** One video in a playlist or channel preview. */
export const PreviewEntry = z
  .object({
    id: z.string(),
    extractor: z.string(),
    /** The page to download it from. */
    url: z.string(),
    title: z.string().nullable(),
    duration: z.number().nullable(),
    uploader: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
  })
  .openapi("PreviewEntry");
export type PreviewEntry = z.infer<typeof PreviewEntry>;

/** A group of preview entries: a channel tab, or the one group of a plain playlist. */
export const PreviewGroup = z
  .object({
    name: z.string(),
    /** The listing's URL (a channel tab, or the pasted link); what a subscription follows. */
    url: z.string().nullable().default(null),
    /** Whether the preview starts with this group's entries ticked. */
    ticked: z.boolean(),
    /** True when the group was cut at the server's entry limit. */
    truncated: z.boolean(),
    entries: z.array(PreviewEntry),
  })
  .openapi("PreviewGroup");
export type PreviewGroup = z.infer<typeof PreviewGroup>;

/** A pasted link: probed by a worker, then previewed when it is a playlist or channel. */
export const DownloadRequest = z
  .object({
    id: Id,
    url: z.string(),
    profileId: Id,
    state: RequestState,
    kind: z.enum(["video", "playlist", "channel"]).nullable(),
    title: z.string().nullable(),
    groups: z.array(PreviewGroup),
    errorKind: DownloadErrorKind.nullable(),
    errorMessage: z.string().nullable(),
    /** A failed probe's last stderr lines from yt-dlp, redacted, for a Details disclosure. */
    stderrTail: z.array(z.string()),
    createdAt: z.iso.datetime(),
  })
  .openapi("DownloadRequest");
export type DownloadRequest = z.infer<typeof DownloadRequest>;

export const QueueSelectionBody = z
  .object({ entryIds: z.array(z.string().min(1).max(256)).min(1).max(10_000) })
  .openapi("QueueSelectionBody");
export type QueueSelectionBody = z.infer<typeof QueueSelectionBody>;

export const QueueSelectionResult = z
  .object({
    queued: z.number().int(),
    /** Already in the library, or already being downloaded. */
    skipped: z.number().int(),
  })
  .openapi("QueueSelectionResult");
export type QueueSelectionResult = z.infer<typeof QueueSelectionResult>;

export const DownloadProgress = z
  .object({
    phase: z.enum(["downloading", "merging", "postprocessing", "storing"]),
    percent: z.number().nullable(),
    downloadedBytes: z.number().nullable(),
    totalBytes: z.number().nullable(),
    /** Bytes per second. */
    speed: z.number().nullable(),
    /** Seconds left. */
    eta: z.number().nullable(),
  })
  .openapi("DownloadProgress");
export type DownloadProgress = z.infer<typeof DownloadProgress>;

export const Download = z
  .object({
    id: Id,
    owner: z.object({ id: Id, displayName: z.string() }),
    url: z.string(),
    title: z.string().nullable(),
    extractor: z.string(),
    videoId: z.string(),
    profileId: Id,
    /** The shared fetch this download waits on; progress events carry it. */
    fetchKey: z.string(),
    state: DownloadState,
    progress: DownloadProgress.nullable(),
    errorKind: DownloadErrorKind.nullable(),
    errorMessage: z.string().nullable(),
    stderrTail: z.array(z.string()),
    attempts: z.number().int(),
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .openapi("Download");
export type Download = z.infer<typeof Download>;

/** One message on `GET /api/downloads/events`. */
export const DownloadEvent = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("state"), download: Download }),
    z.object({ type: z.literal("progress"), fetchKey: z.string(), progress: DownloadProgress }),
    z.object({ type: z.literal("removed"), id: Id }),
    /** The caller's notifications changed (docs/push.md#the-list-in-the-app): fetch them again. */
    z.object({ type: z.literal("notice") }),
  ])
  .openapi("DownloadEvent");
export type DownloadEvent = z.infer<typeof DownloadEvent>;

export const WatchProgress = z
  .object({ position: z.number(), duration: z.number(), watched: z.boolean() })
  .openapi("WatchProgress");
export type WatchProgress = z.infer<typeof WatchProgress>;

export const EntryOrigin = z.enum(["download", "upload"]).openapi("EntryOrigin");
export type EntryOrigin = z.infer<typeof EntryOrigin>;

export const LibraryEntry = z
  .object({
    id: Id,
    mediaId: Id,
    title: z.string(),
    /**
     * Who the video is by: its channel, else its uploader, else the site's own name ("Vimeo",
     * "example.com"), so the server always sends one. Only `channelKey` says a channel page exists.
     */
    channel: z.string().nullable(),
    /** YYYY-MM-DD. */
    uploadDate: z.string().nullable(),
    duration: z.number().nullable(),
    thumbnailUrl: z.string().nullable(),
    /**
     * The hover preview: a short silent MP4 of snippets from across the video (docs/library.md
     * "Hover previews"); null until it is made, and for audio.
     */
    previewUrl: z.string().nullable(),
    /** The format profile it was downloaded with; null for an upload, or once the profile is gone. */
    profileName: z.string().nullable(),
    /** Downloaded from a site, or uploaded by someone (docs/uploads.md). */
    origin: EntryOrigin,
    sizeBytes: z.number(),
    container: z.string().nullable(),
    addedAt: z.iso.datetime(),
    /** The caller's progress on this video; null before they start it. */
    progress: WatchProgress.nullable(),
    tags: z.array(z.string()),
    /** Retention never removes a kept entry. */
    kept: z.boolean(),
    /** The subscription that brought it, if any. */
    subscription: z.object({ id: Id, title: z.string().nullable() }).nullable(),
    /** The channel page's key; null when the site gives no channel. */
    channelKey: z.string().nullable(),
  })
  .openapi("LibraryEntry");
export type LibraryEntry = z.infer<typeof LibraryEntry>;
