import { YtDlpError } from "@uroboros/ytdlp";
import {
  activeCooldown,
  clearRateLimit,
  noteRateLimit,
  requeueDelay,
  siteOf,
} from "../downloads/rateLimits.ts";
import { RequeueError } from "../jobs/errors.ts";
import type { WorkerDeps } from "./deps.ts";

/**
 * A pasted link's probe under its site's rate limit (docs/downloads.md "Rate limits"): it stays
 * probing, saying when it tries again (`retry_at`, error_kind "rate_limited"), and its job goes
 * back to the queue without spending an attempt.
 */

interface ProbingRequest {
  id: string;
  url: string;
  retry_at: Date | null;
}

async function waitOut(deps: WorkerDeps, id: string, until: Date): Promise<never> {
  await deps.db
    .updateTable("download_requests")
    .set({
      error_kind: "rate_limited",
      error_message: "the site is limiting requests",
      retry_at: until,
    })
    .where("id", "=", id)
    .where("state", "=", "probing")
    .execute();
  throw new RequeueError(requeueDelay(until));
}

/**
 * Before the probe asks its site: waits while the site cools down (throws); otherwise forgets an
 * earlier wait, so what the probe comes to is what the request says.
 */
export async function waitForProbeSite(deps: WorkerDeps, req: ProbingRequest): Promise<void> {
  const until = await activeCooldown(deps.db, siteOf(req.url), "site");
  if (until !== null) await waitOut(deps, req.id, until);
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
  const until = await noteRateLimit(deps.db, site, "site", err.retryAfterMs);
  deps.logger.info({ site, until, requestId: req.id }, "site rate-limited a probe");
  await waitOut(deps, req.id, until);
}

/** The probe was answered: the site's limits in a row are over. */
export const probeAnswered = (deps: WorkerDeps, req: ProbingRequest): Promise<void> =>
  clearRateLimit(deps.db, siteOf(req.url), "site");
