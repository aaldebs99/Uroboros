import { DownloadErrorKind, type Subscription } from "@uroboros/contract";
import { sql, type Kysely, type Selectable } from "kysely";
import type { Database, FeedJson, SubscriptionsTable } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { channelKey } from "../library/channelKey.ts";
import { scheduleOf } from "./schedule.ts";

export type SubscriptionRow = Selectable<SubscriptionsTable>;

/** A subscription row with what its contract shape adds: the profile's name and item counts. */
export type ListedRow = SubscriptionRow & {
  profile_name: string;
  queued: string;
  filtered: string;
  waiting: string;
};

const count = (outcome: string) =>
  sql<string>`(SELECT count(*) FROM subscription_items i WHERE i.subscription_id = s.id AND i.outcome = ${outcome})`;

/** The caller's subscriptions with their profile name and counts. */
export function listedQuery(db: Kysely<Database>, userId: string) {
  return db
    .selectFrom("subscriptions as s")
    .innerJoin("format_profiles as p", "p.id", "s.profile_id")
    .selectAll("s")
    .select([
      "p.name as profile_name",
      count("queued").as("queued"),
      count("filtered").as("filtered"),
      count("waiting").as("waiting"),
    ])
    .where("s.user_id", "=", userId);
}

/** One of the caller's subscriptions; another person's is 404. */
export async function ownSubscription(
  db: Kysely<Database>,
  userId: string,
  id: string,
): Promise<ListedRow> {
  const row = await listedQuery(db, userId).where("s.id", "=", id).executeTakeFirst();
  if (row === undefined) throw new ApiError("not_found", "no such subscription");
  return row;
}

const iso = (d: Date | string | null): string | null =>
  d === null ? null : new Date(d).toISOString();

/** A DATE column (pg gives a Date at local midnight) as YYYY-MM-DD. */
function dateText(d: Date | null): string | null {
  if (d === null) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const feedsOf = (feeds: FeedJson[]) => feeds.map((f) => ({ name: f.name, url: f.url }));

function errorOf(row: SubscriptionRow): Subscription["error"] {
  if (row.last_error_message === null) return null;
  const kind = DownloadErrorKind.safeParse(row.last_error_kind);
  return { kind: kind.success ? kind.data : "unknown", message: row.last_error_message };
}

export function toSubscription(row: ListedRow): Subscription {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    extractor: row.extractor,
    sourceId: row.source_id,
    channelKey: row.kind === "channel" ? channelKey(row.extractor, row.source_id, row.title) : null,
    feeds: feedsOf(row.feeds),
    tabs: feedsOf(row.tabs),
    profileId: row.profile_id,
    profileName: row.profile_name,
    schedule: scheduleOf(row),
    enabled: row.enabled,
    notify: row.notify,
    filters: {
      titleInclude: row.title_include,
      titleExclude: row.title_exclude,
      minDuration: row.min_duration_s,
      maxDuration: row.max_duration_s,
      uploadedAfter: dateText(row.uploaded_after),
      excludeShorts: row.exclude_shorts,
      excludeLive: row.exclude_live,
    },
    delayHours: row.delay_hours,
    backfill: { mode: row.backfill, count: row.backfill_count },
    retention: { keepLast: row.keep_last, deleteWatchedAfterDays: row.delete_watched_after_days },
    lastCheckedAt: iso(row.last_checked_at),
    nextCheckAt: row.enabled ? iso(row.next_check_at) : null,
    checking: row.lease_until !== null && new Date(row.lease_until).getTime() > Date.now(),
    error: errorOf(row),
    failures: row.failures,
    warning: row.warning,
    counts: {
      queued: Number(row.queued),
      filtered: Number(row.filtered),
      waiting: Number(row.waiting),
    },
    createdAt: new Date(row.created_at).toISOString(),
  };
}
