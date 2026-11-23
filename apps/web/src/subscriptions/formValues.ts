import type {
  Backfill,
  BackfillMode,
  DownloadRequest,
  NewSubscriptionBody,
  Retention,
  Subscription,
  SubscriptionFilters,
  SubscriptionPatch,
} from "@uroboros/contract";

/** The subscription form's state: number fields stay text until they are sent. */
export interface FormValues {
  feeds: string[];
  profileId: string;
  intervalMinutes: number;
  delayHours: number;
  titleInclude: string;
  titleExclude: string;
  minMinutes: string;
  maxMinutes: string;
  uploadedAfter: string;
  excludeShorts: boolean;
  excludeLive: boolean;
  backfillMode: BackfillMode;
  backfillCount: string;
  keepLast: string;
  deleteWatchedAfterDays: string;
  notify: boolean;
}

export const DEFAULT_INTERVAL = 360;

const text = (s: string): string | null => (s.trim() === "" ? null : s.trim());
const whole = (s: string): number | null => {
  const n = Number(s);
  return s.trim() === "" || !Number.isFinite(n) || n < 0 ? null : Math.round(n);
};
const secondsOf = (minutes: string): number | null => {
  const n = Number(minutes);
  return minutes.trim() === "" || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 60);
};
const minutesOf = (seconds: number | null): string =>
  seconds === null ? "" : String(Math.round((seconds / 60) * 100) / 100);
const textOf = (n: number | null): string => (n === null ? "" : String(n));

export function filtersOf(v: FormValues): SubscriptionFilters {
  return {
    titleInclude: text(v.titleInclude),
    titleExclude: text(v.titleExclude),
    minDuration: secondsOf(v.minMinutes),
    maxDuration: secondsOf(v.maxMinutes),
    uploadedAfter: text(v.uploadedAfter),
    excludeShorts: v.excludeShorts,
    excludeLive: v.excludeLive,
  };
}

export function retentionOf(v: FormValues): Retention {
  const keep = whole(v.keepLast);
  const days = whole(v.deleteWatchedAfterDays);
  return {
    keepLast: keep === 0 ? null : keep,
    deleteWatchedAfterDays: days === 0 ? null : days,
  };
}

export function backfillOf(v: FormValues): Backfill {
  return v.backfillMode === "newest"
    ? { mode: "newest", count: Math.max(1, whole(v.backfillCount) ?? 1) }
    : { mode: v.backfillMode, count: null };
}

const blank = {
  delayHours: 0,
  titleInclude: "",
  titleExclude: "",
  minMinutes: "",
  maxMinutes: "",
  uploadedAfter: "",
  excludeShorts: false,
  excludeLive: false,
  backfillMode: "none",
  backfillCount: "10",
  keepLast: "",
  deleteWatchedAfterDays: "",
  notify: true,
} as const satisfies Partial<FormValues>;

/** A new subscription's starting point: the preview's ticked tabs and its profile. */
export function fromRequest(req: DownloadRequest): FormValues {
  const ticked = req.groups.filter((g) => g.ticked && g.url !== null).map((g) => g.name);
  return {
    ...blank,
    feeds: ticked.length > 0 ? ticked : req.groups.slice(0, 1).map((g) => g.name),
    profileId: req.profileId,
    intervalMinutes: DEFAULT_INTERVAL,
  };
}

export function fromSubscription(sub: Subscription): FormValues {
  const f = sub.filters;
  return {
    feeds: sub.feeds.map((x) => x.name),
    profileId: sub.profileId,
    intervalMinutes: sub.intervalMinutes,
    delayHours: sub.delayHours,
    titleInclude: f.titleInclude ?? "",
    titleExclude: f.titleExclude ?? "",
    minMinutes: minutesOf(f.minDuration),
    maxMinutes: minutesOf(f.maxDuration),
    uploadedAfter: f.uploadedAfter ?? "",
    excludeShorts: f.excludeShorts,
    excludeLive: f.excludeLive,
    backfillMode: sub.backfill.mode,
    backfillCount: textOf(sub.backfill.count),
    keepLast: textOf(sub.retention.keepLast),
    deleteWatchedAfterDays: textOf(sub.retention.deleteWatchedAfterDays),
    notify: sub.notify,
  };
}

export function toCreateBody(v: FormValues, requestId: string): NewSubscriptionBody {
  return {
    requestId,
    feeds: v.feeds,
    profileId: v.profileId,
    intervalMinutes: v.intervalMinutes,
    filters: filtersOf(v),
    delayHours: v.delayHours,
    backfill: backfillOf(v),
    retention: retentionOf(v),
    notify: v.notify,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only what changed since `initial`; empty when nothing did. */
export function toPatch(v: FormValues, initial: FormValues): SubscriptionPatch {
  const patch: SubscriptionPatch = {};
  if (!same(v.feeds, initial.feeds)) patch.feeds = v.feeds;
  if (v.profileId !== initial.profileId) patch.profileId = v.profileId;
  if (v.intervalMinutes !== initial.intervalMinutes) patch.intervalMinutes = v.intervalMinutes;
  if (!same(filtersOf(v), filtersOf(initial))) patch.filters = filtersOf(v);
  if (v.delayHours !== initial.delayHours) patch.delayHours = v.delayHours;
  if (!same(retentionOf(v), retentionOf(initial))) patch.retention = retentionOf(v);
  if (v.notify !== initial.notify) patch.notify = v.notify;
  return patch;
}

/** A warning when the backfill would download more than retention keeps. */
export function backfillWarning(v: FormValues): string | null {
  const keep = retentionOf(v).keepLast;
  if (keep === null || v.backfillMode === "none") return null;
  const count = backfillOf(v).count;
  if (v.backfillMode === "newest" && count !== null && count <= keep) return null;
  return `Retention keeps ${String(keep)}; the rest of the backfill will be removed after it downloads.`;
}
