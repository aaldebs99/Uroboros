import { YtDlpError } from "@uroboros/ytdlp";
import {
  activeCooldown,
  clearRateLimit,
  noteRateLimit,
  requeueDelay,
  siteOf,
} from "../downloads/rateLimits.ts";
import { noticeHeldRequest } from "../downloads/waitNotices.ts";
import { RequeueError } from "../jobs/errors.ts";
import type { WorkerDeps } from "./deps.ts";

/**
 * A pasted link's probe under its site's rate limit (docs/downloads.md "Rate limits"): it stays
 * probing, saying when it tries again (`retry_at`, error_kind "rate_limited"), its person is told
 * once, in their bell, and its job goes back to the queue without spending an attempt.
 */

interface ProbingRequest {
  id: string;
  user_id: string;
  url: string;
  intent: "download" | "subscribe" | "search";
  retry_at: Date | null;
}

async function waitOut(deps: WorkerDeps, req: ProbingRequest, until: Date): Promise<never> {
  // Only a link that starts waiting now is told of: the passes that wait out the cooldown tell
  // nothing more, even to someone who cleared their bell meanwhile.
  const before = await deps.db
    .selectFrom("download_requests")
    .select("error_kind")
    .where("id", "=", req.id)
    .executeTakeFirst();
  const held = await deps.db
    .updateTable("download_requests")
    .set({
      error_kind: "rate_limited",
      error_message: "the site is limiting requests",
      retry_at: until,
    })
    .where("id", "=", req.id)
    .where("state", "=", "probing")
    .executeTakeFirst();
  if (held.numUpdatedRows > 0n && before?.error_kind !== "rate_limited") {
    await noticeHeldRequest(deps.db, req, siteOf(req.url));
  }
  throw new RequeueError(requeueDelay(until));
}

/**
 * Before the probe asks its site: waits while the site cools down (throws); otherwise forgets an
 * earlier wait, so what the probe comes to is what the request says.
 */
export async function waitForProbeSite(deps: WorkerDeps, req: ProbingRequest): Promise<void> {
  const until = await activeCooldown(deps.db, siteOf(req.url), "site");
  if (until !== null) await waitOut(deps, req, until);
  if (req.retry_at === null) return;
  await deps.db
    .updateTable("download_requests")
    .set({ error_kind: null, error_message: null, retry_at: null })
    .where("id", "=", req.id)
    .execute();
}

/** After a failed probe: a rate limit records the site's cooldown and waits it out (throws). */
export async function waitIfProbeLimited(deps: WorkerDeps, req: ProbingRequest, err: unknown) {
  if (!(err instanceof YtDlpError) || err.kind !== "rate_limited") return;
  const site = siteOf(req.url);
  const until = await noteRateLimit(deps.db, site, "site", err.retryAfterMs, {
    source: req.intent === "search" ? "search" : "link",
    message: err.message,
    url: req.url,
    title: null,
  });
  deps.logger.info({ site, until, requestId: req.id }, "site rate-limited a probe");
  await waitOut(deps, req, until);
}

/** The probe was answered: the site's limits in a row are over. */
export const probeAnswered = (deps: WorkerDeps, req: ProbingRequest): Promise<void> =>
  clearRateLimit(deps.db, siteOf(req.url), "site");
