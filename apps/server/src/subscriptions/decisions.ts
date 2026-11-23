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

/** The candidate with what a full probe of it found; null when it could not be probed this time. */
async function probed(
  deps: WorkerDeps,
  sub: SubscriptionRow,
  c: Candidate,
  signal?: AbortSignal,
): Promise<Candidate | "unavailable" | null> {
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
    const kind = toDownloadError(err).kind;
    if (kind === "unavailable" || kind === "private") return "unavailable";
    deps.logger.warn({ err, url: c.url, subscriptionId: sub.id }, "probing a video failed");
    return null;
  } finally {
    await renewLease(deps.db, sub.id);
  }
}

/**
 * Runs the filters over the videos past the backfill: title patterns in one Postgres query, then
 * each video's rules, probing (within the budget) those a filter cannot decide from the listing,
 * then the delay. Videos left undecided are not returned, so the next check sees them again.
 */
export async function filterAll(
  deps: WorkerDeps,
  sub: SubscriptionRow,
  passing: Candidate[],
  known: ReadonlyMap<string, Known>,
  keyOf: (c: Candidate) => string,
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
  let budget = PROBE_BUDGET;
  for (const [i, c] of passing.entries()) {
    const titleOk = ok[i] ?? true;
    let verdict = decide(c, sub, titleOk, false);
    if (verdict.outcome === "probe") {
      if (budget <= 0) continue;
      budget--;
      const full = await probed(deps, sub, c, signal);
      if (full === null) continue;
      verdict =
        full === "unavailable"
          ? { c, outcome: "filtered", reason: "unavailable" }
          : decide(full, sub, titleOk, true);
    }
    if (verdict.outcome === "probe") continue;
    out.push(withDelay(verdict, sub.delay_hours, known.get(keyOf(c))?.seenAt ?? now, now));
  }
  return out;
}
