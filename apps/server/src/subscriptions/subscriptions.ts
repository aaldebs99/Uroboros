import type {
  NewSubscriptionBody,
  Subscription,
  SubscriptionFilters,
  SubscriptionPatch,
} from "@uroboros/contract";
import type { Updateable } from "kysely";
import type { FeedJson, SubscriptionsTable } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { publishDownloadEvent } from "../downloads/events.ts";
import { getProfile } from "../downloads/profiles.ts";
import { toRequest } from "../downloads/requests.ts";
import { checkPattern, normalizePattern } from "./patterns.ts";
import { checkSchedule, firstCheckAt, scheduleColumns } from "./schedule.ts";
import { ownSubscription, toSubscription, type ListedRow } from "./store.ts";

const UNIQUE_VIOLATION = "23505";

/** The contract shape, with the scheduler's next run. */
export function present(row: ListedRow): Subscription {
  return toSubscription(row);
}

async function checkProfile(ctx: DownloadContext, id: string): Promise<void> {
  if ((await getProfile(ctx.db, id)) === undefined) {
    throw new ApiError("bad_request", "no such format profile");
  }
}

/** The filter columns, with patterns normalized and checked by Postgres. */
async function filterColumns(ctx: DownloadContext, f: SubscriptionFilters) {
  const include = f.titleInclude === null ? null : normalizePattern(f.titleInclude);
  const exclude = f.titleExclude === null ? null : normalizePattern(f.titleExclude);
  for (const p of [include, exclude]) if (p !== null) await checkPattern(ctx.db, p);
  return {
    title_include: include,
    title_exclude: exclude,
    min_duration_s: f.minDuration,
    max_duration_s: f.maxDuration,
    uploaded_after: f.uploadedAfter,
    exclude_shorts: f.excludeShorts,
    exclude_live: f.excludeLive,
  };
}

/** The named tabs out of `tabs`, keeping each kept feed's priming. */
function pickFeeds(tabs: FeedJson[], names: string[], current: FeedJson[] = []): FeedJson[] {
  return [...new Set(names)].map((name) => {
    const tab = tabs.find((t) => t.name === name);
    if (tab === undefined) throw new ApiError("bad_request", `not a tab of this source: ${name}`);
    const primedAt = current.find((f) => f.url === tab.url)?.primedAt ?? null;
    return { name: tab.name, url: tab.url, primedAt };
  });
}

function refuseDuplicate(err: unknown): never {
  if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
    throw new ApiError("conflict", "you are already subscribed to this");
  }
  throw err;
}

/** The request a subscription is made from: the caller's channel or playlist preview. */
async function previewRequest(ctx: DownloadContext, userId: string, requestId: string) {
  const req = await ctx.db
    .selectFrom("download_requests")
    .selectAll()
    .where("id", "=", requestId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (req === undefined) throw new ApiError("not_found", "no such request");
  const kind = req.kind;
  if (
    req.state !== "choosing" ||
    (kind !== "channel" && kind !== "playlist") ||
    req.source_extractor === null ||
    req.source_id === null
  ) {
    throw new ApiError("conflict", "this link cannot be subscribed to");
  }
  const tabs = toRequest(req)
    .groups.filter((g) => g.url !== null)
    .map((g) => ({ name: g.name, url: g.url ?? "" }));
  return { req, kind, extractor: req.source_extractor, sourceId: req.source_id, tabs };
}

/** Subscribes the caller from a preview; its scheduler's first check runs at once. */
export async function createSubscription(
  ctx: DownloadContext,
  userId: string,
  body: NewSubscriptionBody,
): Promise<Subscription> {
  const src = await previewRequest(ctx, userId, body.requestId);
  const feeds = pickFeeds(src.tabs, body.feeds);
  checkSchedule(body.schedule, ctx.limits.minCheckIntervalMinutes);
  await checkProfile(ctx, body.profileId);
  const row = await ctx.db
    .insertInto("subscriptions")
    .values({
      user_id: userId,
      kind: src.kind,
      extractor: src.extractor,
      source_id: src.sourceId,
      title: src.req.title,
      url: src.req.url,
      feeds: JSON.stringify(feeds),
      tabs: JSON.stringify(src.tabs),
      profile_id: body.profileId,
      ...scheduleColumns(body.schedule),
      next_check_at: firstCheckAt(scheduleColumns(body.schedule), null, new Date()),
      notify: body.notify,
      ...(await filterColumns(ctx, body.filters)),
      delay_hours: body.delayHours,
      backfill: body.backfill.mode,
      backfill_count: body.backfill.count,
      keep_last: body.retention.keepLast,
      delete_watched_after_days: body.retention.deleteWatchedAfterDays,
    })
    .returning("id")
    .executeTakeFirstOrThrow()
    .catch(refuseDuplicate);
  return present(await ownSubscription(ctx.db, userId, row.id));
}

/**
 * The next check after an edit of the schedule or of `enabled`: none while paused, otherwise the
 * new schedule's first (an interval counts from the last check).
 */
function nextCheckChange(
  current: ListedRow,
  patch: SubscriptionPatch,
): { next_check_at?: Date | null } {
  if (patch.schedule === undefined && patch.enabled === undefined) return {};
  if (!(patch.enabled ?? current.enabled)) return { next_check_at: null };
  const schedule = patch.schedule === undefined ? current : scheduleColumns(patch.schedule);
  return { next_check_at: firstCheckAt(schedule, current.last_checked_at, new Date()) };
}

async function changes(
  ctx: DownloadContext,
  current: ListedRow,
  patch: SubscriptionPatch,
): Promise<Updateable<SubscriptionsTable>> {
  if (patch.schedule !== undefined) {
    checkSchedule(patch.schedule, ctx.limits.minCheckIntervalMinutes);
  }
  if (patch.profileId !== undefined) await checkProfile(ctx, patch.profileId);
  return {
    ...(patch.feeds === undefined
      ? {}
      : { feeds: JSON.stringify(pickFeeds(current.tabs, patch.feeds, current.feeds)) }),
    ...(patch.profileId === undefined ? {} : { profile_id: patch.profileId }),
    ...(patch.schedule === undefined ? {} : scheduleColumns(patch.schedule)),
    ...(patch.filters === undefined
      ? {}
      : { ...(await filterColumns(ctx, patch.filters)), filters_changed_at: new Date() }),
    ...(patch.delayHours === undefined ? {} : { delay_hours: patch.delayHours }),
    ...(patch.retention === undefined
      ? {}
      : {
          keep_last: patch.retention.keepLast,
          delete_watched_after_days: patch.retention.deleteWatchedAfterDays,
        }),
    ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
    ...nextCheckChange(current, patch),
    ...(patch.notify === undefined ? {} : { notify: patch.notify }),
    updated_at: new Date(),
  };
}

/**
 * Edits a subscription. New filters send what the old ones held back back to `waiting`, as
 * backfill, so the next check reconsiders those videos (behind pasted links, with no notice), and
 * a check running meanwhile records nothing; the next check follows the schedule and `enabled`.
 */
export async function updateSubscription(
  ctx: DownloadContext,
  userId: string,
  id: string,
  patch: SubscriptionPatch,
): Promise<Subscription> {
  const current = await ownSubscription(ctx.db, userId, id);
  const set = await changes(ctx, current, patch);
  await ctx.db.transaction().execute(async (tx) => {
    if (patch.filters !== undefined) {
      await tx
        .updateTable("subscription_items")
        .set({ outcome: "waiting", reason: "filters changed", due_at: null, backfill: true })
        .where("subscription_id", "=", id)
        .where("outcome", "=", "filtered")
        .execute();
    }
    await tx.updateTable("subscriptions").set(set).where("id", "=", id).execute();
  });
  return present(await ownSubscription(ctx.db, userId, id));
}

/**
 * Unsubscribes: no more checks, its downloads that have not started are cancelled, and its
 * library entries stay as ordinary entries.
 */
export async function deleteSubscription(
  ctx: DownloadContext,
  userId: string,
  id: string,
): Promise<void> {
  await ownSubscription(ctx.db, userId, id);
  const cancelled = await ctx.db.transaction().execute(async (tx) => {
    const rows = await tx
      .updateTable("downloads")
      .set({ state: "cancelled", finished_at: new Date() })
      .where("subscription_id", "=", id)
      .where("state", "=", "queued")
      .where("dispatched_at", "is", null)
      .returning(["id", "user_id"])
      .execute();
    await tx.deleteFrom("subscriptions").where("id", "=", id).execute();
    return rows;
  });
  for (const d of cancelled) {
    await publishDownloadEvent(ctx.db, {
      kind: "state",
      downloadId: d.id,
      userId: d.user_id,
    });
  }
}
