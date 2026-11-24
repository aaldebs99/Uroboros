import { z } from "@hono/zod-openapi";

/**
 * Why a download or probe failed: every yt-dlp wrapper error kind, plus `storage` for a file that
 * could not be stored. The web shows a message per kind, so a new kind breaks `tsc` there.
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

/** An admin-defined yt-dlp preset. `revision` changes whenever the file-shaping arguments do. */
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
    /** Makes this the default; the old default stops being one. */
    isDefault: z.literal(true).optional(),
  })
  .openapi("FormatProfilePatch");
export type FormatProfilePatch = z.infer<typeof FormatProfilePatch>;

export const NewDownloadBody = z
  .object({
    url: z.url({ protocol: /^https?$/ }).max(2048),
    /** Omitted: the default profile. */
    profileId: Id.optional(),
  })
  .openapi("NewDownloadBody");
export type NewDownloadBody = z.infer<typeof NewDownloadBody>;

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
  ])
  .openapi("DownloadEvent");
export type DownloadEvent = z.infer<typeof DownloadEvent>;

export const WatchProgress = z
  .object({ position: z.number(), duration: z.number(), watched: z.boolean() })
  .openapi("WatchProgress");
export type WatchProgress = z.infer<typeof WatchProgress>;

export const LibraryEntry = z
  .object({
    id: Id,
    mediaId: Id,
    title: z.string(),
    channel: z.string().nullable(),
    /** YYYY-MM-DD. */
    uploadDate: z.string().nullable(),
    duration: z.number().nullable(),
    thumbnailUrl: z.string().nullable(),
    profileName: z.string(),
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
