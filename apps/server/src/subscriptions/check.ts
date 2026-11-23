import type { DownloadErrorKind } from "@uroboros/contract";
import { toDownloadError } from "../downloads/errors.ts";
import type { FeedJson } from "../db/schema.ts";
import type { WorkerDeps } from "../worker/deps.ts";
import { filterAll, type Known } from "./decisions.ts";
import { freeLease, releaseLease, renewLease, takeLease } from "./lease.ts";
import { listFeed, type Candidate } from "./listing.ts";
import { enqueueNotice, FAILING_AFTER, failingNotice, newVideosNotice } from "./notices.ts";
import { PatternTimeout } from "./patterns.ts";
import type { CheckJob } from "./queue.ts";
import { recordAndQueue, type Decision } from "./record.ts";
import type { SubscriptionRow } from "./store.ts";

const keyOf = (c: { extractor: string; videoId: string }) => `${c.extractor}|${c.videoId}`;

/** What a failed check records. */
export function checkFailure(err: unknown): { kind: DownloadErrorKind; message: string } {
  if (err instanceof PatternTimeout) return { kind: "unknown", message: err.message };
  const failure = toDownloadError(err);
  return { kind: failure.kind, message: failure.message };
}

/** Lists every feed, merging by video (the first feed to list one keeps it). */
async function listAll(deps: WorkerDeps, sub: SubscriptionRow, signal?: AbortSignal) {
  const seen = new Set<string>();
  const merged: Candidate[] = [];
  let capped = false;
  for (const feed of sub.feeds) {
    const listed = await listFeed(deps, feed, signal);
    capped ||= listed.capped;
    for (const c of listed.entries) {
      if (seen.has(keyOf(c))) continue;
      seen.add(keyOf(c));
      merged.push(c);
    }
    await renewLease(deps.db, sub.id);
  }
  const max = deps.limits.maxPlaylistEntries;
  const warning =
    capped && sub.kind === "playlist"
      ? `This playlist is longer than ${String(max)} entries; only the first ${String(max)} are followed.`
      : null;
  return { merged, warning };
}

/** The items already recorded for these videos: final ones are skipped, waiting ones revisited. */
async function recorded(deps: WorkerDeps, sub: SubscriptionRow, merged: Candidate[]) {
  if (merged.length === 0) return new Map<string, { outcome: string; seen_at: Date | string }>();
  const rows = await deps.db
    .selectFrom("subscription_items")
    .select(["extractor", "video_id", "outcome", "seen_at"])
    .where("subscription_id", "=", sub.id)
    .where(
      "video_id",
      "in",
      merged.map((c) => c.videoId),
    )
    .execute();
  return new Map(rows.map((r) => [`${r.extractor}|${r.video_id}`, r]));
}

/**
 * The feeds on their first check. On the subscription's very first check that is every feed (and
 * `backfill` applies); after that, a feed added later primes with `none`.
 */
function firstCheckFeeds(sub: SubscriptionRow): {
  feeds: Set<string>;
  backfill: SubscriptionRow["backfill"];
} {
  const primedAny = sub.feeds.some((f) => (f.primedAt ?? null) !== null);
  const feeds = new Set(sub.feeds.filter((f) => (f.primedAt ?? null) === null).map((f) => f.url));
  return { feeds, backfill: primedAny ? "none" : sub.backfill };
}

/** Whether a video on a feed's first check goes on to the filters, by the backfill choice. */
function backfilled(c: Candidate, backfill: SubscriptionRow["backfill"], count: number | null) {
  if (backfill === "all") return true;
  if (backfill === "newest") return c.position < (count ?? 0);
  return false;
}

/** Decides each new video: the backfill first, then the filters (`decisions.ts`). */
async function decideAll(
  deps: WorkerDeps,
  sub: SubscriptionRow,
  fresh: Candidate[],
  first: ReturnType<typeof firstCheckFeeds>,
  known: ReadonlyMap<string, Known>,
  signal?: AbortSignal,
): Promise<Decision[]> {
  const existing: Decision[] = [];
  const passing: Candidate[] = [];
  for (const c of fresh) {
    if (first.feeds.has(c.feed) && !backfilled(c, first.backfill, sub.backfill_count)) {
      existing.push({ c, outcome: "existing" });
    } else {
      passing.push(c);
    }
  }
  return [...existing, ...(await filterAll(deps, sub, passing, known, keyOf, signal))];
}

async function runCheck(
  deps: WorkerDeps,
  sub: SubscriptionRow,
  signal?: AbortSignal,
): Promise<FeedJson[]> {
  const { merged, warning } = await listAll(deps, sub, signal);
  const known = await recorded(deps, sub, merged);
  const fresh = merged.filter((c) => {
    const k = known.get(keyOf(c));
    return k === undefined || k.outcome === "waiting";
  });
  const first = firstCheckFeeds(sub);
  const waiting = new Map(
    [...known].map(([k, r]) => [k, { seenAt: new Date(r.seen_at) }] as const),
  );
  const decisions = await decideAll(deps, sub, fresh, first, waiting, signal);
  const { queuedNew } = await recordAndQueue(deps, sub, decisions, first.feeds);
  if (sub.notify && queuedNew.length > 0) {
    const titles = queuedNew.map((c) => c.title ?? c.videoId);
    await enqueueNotice(deps.queues.notify, sub.user_id, newVideosNotice(sub, titles), "normal");
  }
  const now = new Date().toISOString();
  const feeds = sub.feeds.map((f) => ({ ...f, primedAt: f.primedAt ?? now }));
  await releaseLease(deps.db, sub.id, { ok: true, feeds, warning });
  return feeds;
}

/**
 * The `automation` queue's `check` job: list, filter, record and queue (docs/automation.md).
 * `signal` (shutdown) stops a running check; it records nothing and the schedule runs it again.
 */
export function checkProcessor(deps: WorkerDeps, signal?: AbortSignal) {
  return async (job: { data: CheckJob }): Promise<void> => {
    const sub = await takeLease(deps.db, job.data.subscriptionId);
    if (sub === undefined) return;
    try {
      await runCheck(deps, sub, signal);
    } catch (err) {
      if (signal?.aborted === true) {
        await freeLease(deps.db, sub.id);
        return;
      }
      deps.logger.warn({ err, subscriptionId: sub.id }, "subscription check failed");
      const failure = checkFailure(err);
      const { failures } = await releaseLease(deps.db, sub.id, { ok: false, ...failure });
      // Once per failing streak: the count only passes 3 again after a check succeeds.
      if (sub.notify && failures === FAILING_AFTER) {
        await enqueueNotice(
          deps.queues.notify,
          sub.user_id,
          failingNotice(sub, failure.message),
          "high",
        );
      }
    }
  };
}
