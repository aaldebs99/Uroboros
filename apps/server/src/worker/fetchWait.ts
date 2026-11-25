import { YtDlpError } from "@uroboros/ytdlp";
import { publishDownloadEvents } from "../downloads/events.ts";
import {
  activeCooldown,
  clearRateLimit,
  noteRateLimit,
  requeueDelay,
  siteOf,
} from "../downloads/rateLimits.ts";
import { RequeueError } from "../jobs/errors.ts";
import type { WorkerDeps } from "./deps.ts";
import { subtitleArgs, withSubtitleFallback, type SubtitleOutcome } from "./subtitles.ts";
import { queueHeldSubtitles } from "./subtitlesJob.ts";

/**
 * A fetch and the site it asks, under rate limits (docs/downloads.md "Rate limits"): while the site
 * cools down, the fetch's downloads wait, queued, and the job goes back to its queue without
 * spending an attempt. A rate limit never fails a download; the person can cancel it.
 */

interface WaitingFetch {
  data: { fetchKey: string; url: string };
  attemptsMade: number;
}

const ACTIVE = ["queued", "running"] as const;

/** Puts the fetch's downloads back to queued until `until`, and the job back in its queue. */
async function waitOut(deps: WorkerDeps, job: WaitingFetch, until: Date): Promise<never> {
  const rows = await deps.db
    .updateTable("downloads")
    .set({
      state: "queued",
      error_kind: "rate_limited",
      error_message: "the site is limiting requests",
      retry_at: until,
      attempts: job.attemptsMade,
    })
    .where("fetch_key", "=", job.data.fetchKey)
    .where("state", "in", ACTIVE)
    .returning(["id", "user_id"])
    .execute();
  await publishDownloadEvents(
    deps.db,
    rows.map((r) => ({ kind: "state", downloadId: r.id, userId: r.user_id })),
  );
  throw new RequeueError(requeueDelay(until));
}

/** Before the fetch asks its site anything: waits while the site cools down (throws). */
export async function waitForSite(deps: WorkerDeps, job: WaitingFetch): Promise<void> {
  const until = await activeCooldown(deps.db, siteOf(job.data.url), "site");
  if (until !== null) await waitOut(deps, job, until);
}

/**
 * After a failed run: a rate limit records the site's cooldown (as long as the site said, or the
 * estimate) and waits it out (throws). Any other failure returns, to be handled as before.
 */
export async function waitIfLimited(deps: WorkerDeps, job: WaitingFetch, err: unknown) {
  if (!(err instanceof YtDlpError) || err.kind !== "rate_limited") return;
  const site = siteOf(job.data.url);
  const until = await noteRateLimit(deps.db, site, "site", err.retryAfterMs);
  deps.logger.info({ site, until, fetchKey: job.data.fetchKey }, "site rate-limited a fetch");
  await waitOut(deps, job, until);
}

/**
 * Runs the fetch's yt-dlp with its subtitles (`withSubtitleFallback`), unless the site's subtitles
 * are cooling down; a subtitle the site rate-limits starts that cooldown. `heldUntil` says when
 * held-back subtitles may be fetched.
 */
export async function runWithSubtitles<T>(
  deps: WorkerDeps,
  url: string,
  run: (extraArgs: string[]) => Promise<T>,
  profile: string[],
  signal: AbortSignal,
): Promise<{ result: T; subtitles: SubtitleOutcome; heldUntil: Date | null }> {
  const site = siteOf(url);
  let heldUntil = await activeCooldown(deps.db, site, "subtitles");
  const outcome = await withSubtitleFallback(
    run,
    { profile, subtitles: subtitleArgs(deps.subtitles), held: heldUntil !== null },
    signal,
    deps.logger,
    async (hintMs) => {
      heldUntil = await noteRateLimit(deps.db, site, "subtitles", hintMs);
    },
  );
  return { ...outcome, heldUntil };
}

/**
 * After a stored fetch: the site answered, so its limits in a row are over (its subtitles' too when
 * they came), and subtitles it held back are queued for when their cooldown ends.
 */
export async function afterAnswered(
  deps: WorkerDeps,
  data: { fetchKey: string; url: string },
  rendition: { id: string; media_id: string },
  subtitles: SubtitleOutcome,
  heldUntil: Date | null,
): Promise<void> {
  const site = siteOf(data.url);
  await clearRateLimit(deps.db, site, "site");
  if (subtitles === "fetched") await clearRateLimit(deps.db, site, "subtitles");
  if (subtitles !== "held" || heldUntil === null) return;
  const first = await deps.db
    .selectFrom("downloads")
    .select("user_id")
    .where("fetch_key", "=", data.fetchKey)
    .orderBy("created_at")
    .executeTakeFirst();
  if (first === undefined) return;
  await queueHeldSubtitles(
    deps,
    {
      mediaId: rendition.media_id,
      renditionId: rendition.id,
      url: data.url,
      userId: first.user_id,
    },
    heldUntil,
  );
}
