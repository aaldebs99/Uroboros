import type { DownloadErrorKind } from "@uroboros/contract";
import { probe } from "@uroboros/ytdlp";
import { toDownloadError } from "../downloads/errors.ts";
import type { WorkerDeps } from "../worker/deps.ts";
import { ytdlpOptions } from "../worker/probe.ts";
import { decide, withDelay } from "./filters.ts";
import { renewLease } from "./lease.ts";
import type { Candidate } from "./listing.ts";
import { titlesPass } from "./patterns.ts";
import type { Decision } from "./record.ts";
import type { SubscriptionRow } from "./store.ts";

/** Full probes one check may run; the rest wait for the next check, unrecorded. */
export const PROBE_BUDGET = 50;

/** What the check knows about a video it has seen before (only `waiting` ones come back here). */
export interface Known {
  seenAt: Date;
}

/** Probe failures that will not change by asking again: recorded as filtered, with this reason. */
const FINAL_FAILURES: Partial<Record<DownloadErrorKind, string>> = {
  unavailable: "unavailable",
  private: "unavailable",
  age_restricted: "age-restricted",
  geo_blocked: "geo-blocked",
  unsupported_url: "unsupported",
};

/**
 * The candidate with what a full probe of it found; a final failure's reason ("age-restricted");
 * or null when it could not be probed this time.
 */
async function probed(
  deps: WorkerDeps,
  sub: SubscriptionRow,
  c: Candidate,
  signal?: AbortSignal,
): Promise<Candidate | { reason: string } | null> {
  try {
    const info = await probe(c.url, {
      ...ytdlpOptions(deps),
      flat: false,
      ...(signal === undefined ? {} : { signal }),
    });
    if (info.kind !== "video") return null;
    return {
      ...c,
      title: info.title ?? c.title,
      duration: info.duration ?? c.duration,
      liveStatus: info.liveStatus ?? c.liveStatus,
      availability: info.availability ?? c.availability,
      uploadDate: info.uploadDate ?? c.uploadDate,
      mediaType: info.mediaType ?? c.mediaType,
    };
  } catch (err) {
    if (signal?.aborted === true) throw err;
    const reason = FINAL_FAILURES[toDownloadError(err).kind];
    if (reason !== undefined) return { reason };
    deps.logger.warn({ err, url: c.url, subscriptionId: sub.id }, "probing a video failed");
    return null;
  } finally {
    await renewLease(deps.db, sub.id);
  }
}

const waiting = (c: Candidate, reason: string): Decision => ({
  c,
  outcome: "waiting",
  reason,
  dueAt: null,
});

/** One video's decision, probing it (when the budget allows) if a filter needs it. */
async function decideOne(
  deps: WorkerDeps,
  sub: SubscriptionRow,
  c: Candidate,
  titleOk: boolean,
  budget: { left: number },
  signal?: AbortSignal,
): Promise<Decision> {
  const verdict = decide(c, sub, titleOk, false);
  if (verdict.outcome !== "probe") return verdict;
  // Recorded as waiting rather than dropped, so a backfilled video stays the backfill next time.
  if (budget.left <= 0) return waiting(c, "not checked yet");
  budget.left--;
  const full = await probed(deps, sub, c, signal);
  if (full === null) return waiting(c, "could not be checked");
  if ("reason" in full) return { c, outcome: "filtered", reason: full.reason };
  const decided = decide(full, sub, titleOk, true);
  return decided.outcome === "probe" ? waiting(c, "could not be checked") : decided;
}

/**
 * Runs the filters over the videos past the backfill: title patterns in one Postgres query, then
 * each video's rules, probing (within the budget) those a filter cannot decide from the listing,
 * then the wait, which the backfill skips (old videos already have their SponsorBlock segments).
 */
export async function filterAll(
  deps: WorkerDeps,
  sub: SubscriptionRow,
  passing: Candidate[],
  known: ReadonlyMap<string, Known>,
  keyOf: (c: Candidate) => string,
  isBackfill: (c: Candidate) => boolean,
  signal?: AbortSignal,
): Promise<Decision[]> {
  const ok = await titlesPass(
    deps.db,
    passing.map((c) => c.title),
    sub.title_include,
    sub.title_exclude,
  );
  const now = new Date();
  const out: Decision[] = [];
  const budget = { left: PROBE_BUDGET };
  for (const [i, c] of passing.entries()) {
    const verdict = await decideOne(deps, sub, c, ok[i] ?? true, budget, signal);
    const delay = isBackfill(c) ? 0 : sub.delay_hours;
    out.push(withDelay(verdict, delay, known.get(keyOf(c))?.seenAt ?? now, now));
  }
  return out;
}
