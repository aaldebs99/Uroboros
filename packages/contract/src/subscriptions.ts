import { z } from "@hono/zod-openapi";
import { DownloadErrorKind, DownloadState } from "./downloads.ts";

const Id = z.uuid();

/** A week: the longest interval. The shortest is the deployment's minimum. */
export const MAX_CHECK_INTERVAL_MINUTES = 10080;
/** The most a "newest N" backfill or a "download the latest N" takes from each feed. */
export const MAX_LATEST = 50;

/** A listing a subscription follows: a channel tab, or the playlist itself. */
export const Feed = z.object({ name: z.string(), url: z.string() }).openapi("Feed");
export type Feed = z.infer<typeof Feed>;

const Pattern = z.string().trim().min(1).max(500).nullable().default(null);
const Seconds = z.number().int().min(0).max(1_000_000).nullable().default(null);

/** What a check lets through (docs/automation.md). Patterns are Postgres regexes, case-insensitive. */
export const SubscriptionFilters = z
  .object({
    titleInclude: Pattern,
    titleExclude: Pattern,
    minDuration: Seconds,
    maxDuration: Seconds,
    /** YYYY-MM-DD: only videos uploaded on or after it. */
    uploadedAfter: z.iso.date().nullable().default(null),
    /** Playlists only: a channel leaves Shorts out by not following its Shorts tab. */
    excludeShorts: z.boolean().default(false),
    excludeLive: z.boolean().default(false),
  })
  .refine(
    (f) => f.minDuration === null || f.maxDuration === null || f.minDuration <= f.maxDuration,
    {
      message: "minDuration is above maxDuration",
      path: ["minDuration"],
    },
  )
  .openapi("SubscriptionFilters");
export type SubscriptionFilters = z.infer<typeof SubscriptionFilters>;

/** Which of the subscription's videos stay in the person's library. */
export const Retention = z
  .object({
    keepLast: z.number().int().min(1).max(10_000).nullable().default(null),
    deleteWatchedAfterDays: z.number().int().min(1).max(3650).nullable().default(null),
  })
  .openapi("Retention");
export type Retention = z.infer<typeof Retention>;

export const BackfillMode = z.enum(["none", "newest", "all"]).openapi("BackfillMode");
export type BackfillMode = z.infer<typeof BackfillMode>;

/** What the first check does with the videos already there. */
export const Backfill = z
  .object({
    mode: BackfillMode,
    /** How many of each tab's newest (at most 50); required with `newest`, else null. */
    count: z.number().int().min(1).max(MAX_LATEST).nullable().default(null),
  })
  .refine((b) => (b.mode === "newest") === (b.count !== null), {
    message: "count goes with mode newest, and only with it",
    path: ["count"],
  })
  .openapi("Backfill");
export type Backfill = z.infer<typeof Backfill>;

const Interval = z.number().int().min(1).max(MAX_CHECK_INTERVAL_MINUTES);

/**
 * When a subscription is checked: every `minutes` (between the deployment's minimum and a week),
 * on a standard 5-field cron (minute hour day month weekday) in an IANA timezone, whose runs are
 * never closer together than the minimum (the server checks both), or `manual`: only when the
 * person checks it.
 */
export const CheckSchedule = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("interval"), minutes: Interval }),
    z.object({ kind: z.literal("manual") }),
    z.object({
      kind: z.literal("cron"),
      expression: z.string().trim().min(9).max(120),
      timezone: z.string().trim().min(1).max(64),
    }),
  ])
  .openapi("CheckSchedule");
export type CheckSchedule = z.infer<typeof CheckSchedule>;
const Delay = z.number().int().min(0).max(168);
const FeedNames = z.array(z.string().min(1).max(64)).min(1).max(10);

export const NewSubscriptionBody = z
  .object({
    /** A `choosing` channel or playlist request of the caller's (the preview). */
    requestId: Id,
    /** Names of the preview's groups to follow. */
    feeds: FeedNames,
    profileId: Id,
    schedule: CheckSchedule,
    filters: SubscriptionFilters.default({
      titleInclude: null,
      titleExclude: null,
      minDuration: null,
      maxDuration: null,
      uploadedAfter: null,
      excludeShorts: false,
      excludeLive: false,
    }),
    /** Hours to wait after first seeing a video before downloading it (SponsorBlock). */
    delayHours: Delay.default(0),
    backfill: Backfill.default({ mode: "none", count: null }),
    retention: Retention.default({ keepLast: null, deleteWatchedAfterDays: null }),
    notify: z.boolean().default(true),
    /** Download what passes the filters; false leaves it `new` in the activity, to pick. */
    autoDownload: z.boolean().default(true),
  })
  .openapi("NewSubscriptionBody");
export type NewSubscriptionBody = z.infer<typeof NewSubscriptionBody>;

/**
 * Download a subscription's latest videos now: the newest `count` of each followed tab for a
 * channel, the last `count` entries for a playlist, whatever its filters say.
 */
export const LatestBody = z
  .object({ count: z.number().int().min(1).max(MAX_LATEST) })
  .openapi("LatestBody");
export type LatestBody = z.infer<typeof LatestBody>;

/** Edits; `backfill` is fixed once created. At least one field. */
export const SubscriptionPatch = z
  .object({
    feeds: FeedNames.optional(),
    profileId: Id.optional(),
    schedule: CheckSchedule.optional(),
    filters: SubscriptionFilters.optional(),
    delayHours: Delay.optional(),
    retention: Retention.optional(),
    enabled: z.boolean().optional(),
    notify: z.boolean().optional(),
    autoDownload: z.boolean().optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), {
    message: "nothing to change",
  })
  .openapi("SubscriptionPatch");
export type SubscriptionPatch = z.infer<typeof SubscriptionPatch>;

export const Subscription = z
  .object({
    id: Id,
    kind: z.enum(["channel", "playlist"]),
    title: z.string().nullable(),
    url: z.string(),
    extractor: z.string(),
    sourceId: z.string(),
    /** The library's channel page for a channel subscription; null for a playlist. */
    channelKey: z.string().nullable(),
    feeds: z.array(Feed),
    /** Every tab the preview offered, which `feeds` may be chosen from. */
    tabs: z.array(Feed),
    profileId: Id,
    profileName: z.string(),
    schedule: CheckSchedule,
    enabled: z.boolean(),
    notify: z.boolean(),
    /** Checks queue what passes the filters; false leaves it `new`, for the person to pick. */
    autoDownload: z.boolean(),
    filters: SubscriptionFilters,
    delayHours: z.number().int(),
    backfill: Backfill,
    retention: Retention,
    lastCheckedAt: z.iso.datetime().nullable(),
    /** When the scheduler fires next; null while paused, and always for a manual schedule. */
    nextCheckAt: z.iso.datetime().nullable(),
    /** A check is running now. */
    checking: z.boolean(),
    error: z.object({ kind: DownloadErrorKind, message: z.string() }).nullable(),
    /** Checks failed in a row. */
    failures: z.number().int(),
    /** Why the last check was incomplete (a playlist past the entry cap). */
    warning: z.string().nullable(),
    counts: z.object({
      queued: z.number().int(),
      /** Videos a check left for the person to pick (auto-download off). */
      new: z.number().int(),
      filtered: z.number().int(),
      waiting: z.number().int(),
    }),
    createdAt: z.iso.datetime(),
  })
  .openapi("Subscription");
export type Subscription = z.infer<typeof Subscription>;

/** `new`: passed the filters, left for the person to pick because auto-download is off. */
export const SubscriptionItemOutcome = z
  .enum(["queued", "new", "filtered", "existing", "waiting"])
  .openapi("SubscriptionItemOutcome");
export type SubscriptionItemOutcome = z.infer<typeof SubscriptionItemOutcome>;

/** One video a subscription saw, and what became of it. */
export const SubscriptionItem = z
  .object({
    extractor: z.string(),
    videoId: z.string(),
    title: z.string().nullable(),
    url: z.string(),
    outcome: SubscriptionItemOutcome,
    /** Which filter held it back, or why it waits. */
    reason: z.string().nullable(),
    seenAt: z.iso.datetime(),
    dueAt: z.iso.datetime().nullable(),
    downloadId: Id.nullable(),
    /**
     * How its download is doing, while it has one: `outcome` says only that it was queued. Null for
     * one never queued, or queued with no download of its own (already had or on its way).
     */
    downloadState: DownloadState.nullable(),
    /** The caller's library entry for it, once downloaded. */
    entryId: Id.nullable(),
  })
  .openapi("SubscriptionItem");
export type SubscriptionItem = z.infer<typeof SubscriptionItem>;

/** Download one video a subscription saw but didn't (skipped, filtered or waiting), now. */
export const ItemDownloadBody = z
  .object({ extractor: z.string().min(1).max(64), videoId: z.string().min(1).max(256) })
  .openapi("ItemDownloadBody");
export type ItemDownloadBody = z.infer<typeof ItemDownloadBody>;

export const SubscriptionItemsPage = z
  .object({ items: z.array(SubscriptionItem), nextCursor: z.string().nullable() })
  .openapi("SubscriptionItemsPage");
export type SubscriptionItemsPage = z.infer<typeof SubscriptionItemsPage>;

export const KeptBody = z.object({ kept: z.boolean() }).openapi("KeptBody");
export type KeptBody = z.infer<typeof KeptBody>;
