import { YtDlpError } from "@uroboros/ytdlp";
import { publishDownloadEvents } from "../downloads/events.ts";
import {
  activeCooldown,
  clearRateLimit,
  noteRateLimit,
  noteRateLimitLogged,
  requeueDelay,
  siteOf,
} from "../downloads/rateLimits.ts";
import { noticeHeldDownloads, noticeHeldSubtitles } from "../downloads/waitNotices.ts";
import { RequeueError } from "../jobs/errors.ts";
import type { WorkerDeps } from "./deps.ts";
import { subtitleArgs, withSubtitleFallback, type SubtitleOutcome } from "./subtitles.ts";
import { queueHeldSubtitles } from "./subtitlesJob.ts";

/**
 * A fetch and the site it asks, under rate limits (docs/downloads.md "Rate limits"): while the site
 * cools down, the fetch's downloads wait, queued, and the job goes back to its queue without
 * spending an attempt; each download's person is told once, in their bell. A rate limit never fails
 * a download; the person can cancel it.
 */

interface WaitingFetch {
  data: { fetchKey: string; url: string };
  attemptsMade: number;
}

const ACTIVE = ["queued", "running"] as const;

/**
 * Puts the fetch's downloads back to queued until `until`, tells each one's person (once), and puts
 * the job back in its queue.
 */
async function waitOut(deps: WorkerDeps, job: WaitingFetch, until: Date): Promise<never> {
  // Only a download that starts waiting now is told of: the passes that wait out the cooldown
  // tell nothing more, even to someone who cleared their bell meanwhile.
  const starting = await deps.db
    .selectFrom("downloads")
    .select("id")
    .where("fetch_key", "=", job.data.fetchKey)
    .where("state", "in", ACTIVE)
    .where("error_kind", "is distinct from", "rate_limited")
    .execute();
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
    .returning(["id", "user_id", "title", "url"])
    .execute();
  await publishDownloadEvents(
    deps.db,
    rows.map((r) => ({ kind: "state", downloadId: r.id, userId: r.user_id })),
  );
  const told = new Set(starting.map((r) => r.id));
  await noticeHeldDownloads(
    deps.db,
    rows.filter((r) => told.has(r.id)),
    siteOf(job.data.url),
  );
  throw new RequeueError(requeueDelay(until));
}

/** Before the fetch asks its site anything: waits while the site cools down (throws). */
export async function waitForSite(deps: WorkerDeps, job: WaitingFetch): Promise<void> {
  const until = await activeCooldown(deps.db, siteOf(job.data.url), "site");
  if (until !== null) await waitOut(deps, job, until);
}

/** The title the fetch's downloads were queued with (the earliest's), for the log. */
async function fetchTitle(deps: WorkerDeps, fetchKey: string): Promise<string | null> {
  const row = await deps.db
    .selectFrom("downloads")
    .select("title")
    .where("fetch_key", "=", fetchKey)
    .orderBy("created_at")
    .executeTakeFirst();
  return row?.title ?? null;
}

/**
 * After a failed run: a rate limit records the site's cooldown (as long as the site said, or the
 * estimate) and waits it out (throws). Any other failure returns, to be handled as before.
 */
export async function waitIfLimited(deps: WorkerDeps, job: WaitingFetch, err: unknown) {
  if (!(err instanceof YtDlpError) || err.kind !== "rate_limited") return;
  const site = siteOf(job.data.url);
  const until = await noteRateLimit(deps.db, site, "site", err.retryAfterMs, {
    source: "download",
    message: err.message,
    url: job.data.url,
    title: await fetchTitle(deps, job.data.fetchKey),
  });
  deps.logger.info({ site, until, fetchKey: job.data.fetchKey }, "site rate-limited a fetch");
  await waitOut(deps, job, until);
}

/** How a fetch's run went: its result, its subtitles, and the limit that held them, if any. */
export interface SubtitledRun<T> {
  result: T;
  subtitles: SubtitleOutcome;
  /** When held-back subtitles may be fetched. */
  heldUntil: Date | null;
  /** The logged limit that held them back, to name the video once it is stored. */
  limitEventId: string | null;
}

/**
 * Runs the fetch's yt-dlp with its subtitles (`withSubtitleFallback`), unless the site's subtitles
 * are cooling down; a subtitle the site rate-limits starts that cooldown.
 */
export async function runWithSubtitles<T>(
  deps: WorkerDeps,
  data: { fetchKey: string; url: string },
  run: (extraArgs: string[]) => Promise<T>,
  profile: string[],
  signal: AbortSignal,
): Promise<SubtitledRun<T>> {
  const site = siteOf(data.url);
  let heldUntil = await activeCooldown(deps.db, site, "subtitles");
  let limitEventId: string | null = null;
  const outcome = await withSubtitleFallback(
    run,
    { profile, subtitles: subtitleArgs(deps.subtitles), held: heldUntil !== null },
    signal,
    deps.logger,
    async (limit) => {
      const logged = await noteRateLimitLogged(deps.db, site, "subtitles", limit.retryAfterMs, {
        source: "subtitles",
        message: limit.message,
        url: data.url,
        title: await fetchTitle(deps, data.fetchKey),
      });
      heldUntil = logged.until;
      limitEventId = logged.eventId;
    },
  );
  return { ...outcome, heldUntil, limitEventId };
}

/** Tells everyone the fetch stored the video for that its subtitles come later. */
async function tellHeldSubtitles(
  deps: WorkerDeps,
  data: { fetchKey: string; url: string },
  renditionId: string,
): Promise<void> {
  const rows = await deps.db
    .selectFrom("downloads as d")
    .leftJoin("library_entries as e", (j) =>
      j.onRef("e.rendition_id", "=", "d.rendition_id").onRef("e.user_id", "=", "d.user_id"),
    )
    .select(["d.id", "d.user_id", "d.title", "d.video_id", "e.id as entry_id"])
    .where("d.fetch_key", "=", data.fetchKey)
    .where("d.rendition_id", "=", renditionId)
    .where("d.state", "=", "done")
    .execute();
  await noticeHeldSubtitles(
    deps.db,
    rows.map((r) => ({ ...r, title: r.title ?? r.video_id })),
    siteOf(data.url),
  );
}

/**
 * After a stored fetch: the site answered, so its limits in a row are over (its subtitles' too when
 * they came); the limit that held its subtitles back names the stored video; and those subtitles
 * are queued for when their cooldown ends.
 */
export async function afterAnswered(
  deps: WorkerDeps,
  data: { fetchKey: string; url: string },
  rendition: { id: string; media_id: string },
  { subtitles, heldUntil, limitEventId }: Omit<SubtitledRun<unknown>, "result">,
): Promise<void> {
  const site = siteOf(data.url);
  if (limitEventId !== null) {
    await deps.db
      .updateTable("rate_limit_events")
      .set({ media_id: rendition.media_id })
      .where("id", "=", limitEventId)
      .execute();
  }
  await clearRateLimit(deps.db, site, "site");
  if (subtitles === "fetched") await clearRateLimit(deps.db, site, "subtitles");
  if (subtitles !== "held" || heldUntil === null) return;
  await tellHeldSubtitles(deps, data, rendition.id);
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
