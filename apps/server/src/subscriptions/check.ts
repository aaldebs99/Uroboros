import type { DownloadErrorKind } from "@uroboros/contract";
import { toDownloadError } from "../downloads/errors.ts";
import { recordPlaylistItems } from "../downloads/sources.ts";
import type { WorkerDeps } from "../worker/deps.ts";
import { withLoginsOf } from "../worker/logins.ts";
import { filterAll } from "./decisions.ts";
import { freeLease, releaseLease, renewLease, takeLease } from "./lease.ts";
import { candidateKey, listFeed, type Candidate } from "./listing.ts";
import { enqueueNotice, FAILING_AFTER, failingNotice, newVideosNotice } from "./notices.ts";
import { PatternTimeout } from "./patterns.ts";
import { checkNow, type CheckJob } from "./queue.ts";
import { recordAndQueue, type Decision } from "./record.ts";
import type { SubscriptionRow } from "./store.ts";

const keyOf = candidateKey;

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

interface Recorded {
  outcome: string;
  seen_at: Date | string;
  due_at: Date | string | null;
  backfill: boolean;
}

/** The items already recorded for these videos: final ones are skipped, waiting ones revisited. */
async function recorded(
  deps: WorkerDeps,
  sub: SubscriptionRow,
  merged: Candidate[],
): Promise<Map<string, Recorded>> {
  if (merged.length === 0) return new Map();
  const rows = await deps.db
    .selectFrom("subscription_items")
    .select(["extractor", "video_id", "outcome", "seen_at", "due_at", "backfill"])
    .where("subscription_id", "=", sub.id)
    .where(
      "video_id",
      "in",
      merged.map((c) => c.videoId),
    )
    .execute();
  return new Map(rows.map((r) => [`${r.extractor}|${r.video_id}`, r]));
}

/** Unseen, or waiting and due again: an item held by the wait is left alone until `due_at`. */
function isFresh(k: Recorded | undefined, now: Date): boolean {
  if (k === undefined) return true;
  if (k.outcome !== "waiting") return false;
  return k.due_at === null || new Date(k.due_at) <= now;
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

/**
 * Decides each new video: the backfill first, then the filters (`decisions.ts`). Returns the
 * decisions and which of them belong to the backfill (decided on a feed's first check, or held
 * back then), whenever they are finally queued.
 */
async function decideAll(
  deps: WorkerDeps,
  sub: SubscriptionRow,
  fresh: Candidate[],
  known: ReadonlyMap<string, Recorded>,
  signal?: AbortSignal,
): Promise<{ decisions: Decision[]; backfill: Set<string> }> {
  const first = firstCheckFeeds(sub);
  const existing: Decision[] = [];
  const passing: Candidate[] = [];
  const backfill = new Set<string>();
  for (const c of fresh) {
    if (first.feeds.has(c.feed)) {
      if (!backfilled(c, first.backfill, sub.backfill_count)) {
        existing.push({ c, outcome: "existing" });
        continue;
      }
      backfill.add(keyOf(c));
    } else if (known.get(keyOf(c))?.backfill === true) {
      backfill.add(keyOf(c));
    }
    passing.push(c);
  }
  const seen = new Map([...known].map(([k, r]) => [k, { seenAt: new Date(r.seen_at) }] as const));
  const filtered = await filterAll(
    deps,
    sub,
    passing,
    seen,
    keyOf,
    (c) => backfill.has(keyOf(c)),
    signal,
  );
  return { decisions: [...existing, ...filtered], backfill };
}

/**
 * A followed playlist is one of its follower's YouTube playlists (docs/sharing.md): each check
 * records it with the listing's order. Channels are not recorded.
 */
async function recordFollowed(deps: WorkerDeps, sub: SubscriptionRow, merged: Candidate[]) {
  if (sub.kind !== "playlist") return;
  const ref = { extractor: sub.extractor, sourceId: sub.source_id, title: sub.title, url: sub.url };
  await deps.db.transaction().execute((tx) => recordPlaylistItems(tx, sub.user_id, ref, merged));
}

/** Runs one check; "stale" when the filters changed while it ran (it then recorded nothing). */
async function runCheck(
  deps: WorkerDeps,
  sub: SubscriptionRow,
  signal?: AbortSignal,
): Promise<"done" | "stale"> {
  const { merged, warning } = await listAll(deps, sub, signal);
  await recordFollowed(deps, sub, merged);
  const known = await recorded(deps, sub, merged);
  const now = new Date();
  const fresh = merged.filter((c) => isFresh(known.get(keyOf(c)), now));
  const { decisions, backfill } = await decideAll(deps, sub, fresh, known, signal);
  const result = await recordAndQueue(deps, sub, decisions, backfill);
  if (result === "stale") return "stale";
  if (sub.notify && result.queuedNew.length > 0) {
    const titles = result.queuedNew.map((c) => c.title ?? c.videoId);
    await enqueueNotice(deps.queues.notify, sub.user_id, newVideosNotice(sub, titles), "normal");
  }
  const primedUrls = sub.feeds.filter((f) => (f.primedAt ?? null) === null).map((f) => f.url);
  await releaseLease(deps.db, sub.id, { ok: true, primedUrls, warning });
  return "done";
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
      // The owner's logins sign in the listing and the full probes.
      if ((await runCheck(await withLoginsOf(deps, sub.user_id), sub, signal)) === "stale") {
        // Decided under filters the person has since changed: check again under the new ones.
        await freeLease(deps.db, sub.id);
        await checkNow(deps.queues.automation, sub.id);
      }
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
