import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { JobQueue } from "../jobs/queues.ts";
/**
 * A job on the `automation` queue (docs/automation.md): a `check` of one subscription (queued by
 * the leader when its next check comes round, `due.ts`, or asked for now), or a `latest` that
 * downloads its newest `count` videos (`latest.ts`).
 */
export interface CheckJob {
  subscriptionId: string;
  /** A `latest` job: how many of each feed's newest to download. */
  count?: number;
}

/** A one-off check; a second while one waits or runs is the same job (`check|<id>`). */
export async function checkNow(
  q: JobQueue<CheckJob>,
  id: string,
  on?: Kysely<Database>,
): Promise<void> {
  await q.add("check", { subscriptionId: id }, { key: `check|${id}` }, on);
}

/** How long a `latest` waits for a running check to let go of the subscription, between tries. */
const LATEST_RETRY_MS = 30_000;

/**
 * Downloads the subscription's latest `count` videos, in a job: yt-dlp lists them, and only job
 * consumers run it. One waiting already (`latest|<id>`) absorbs another; while a check holds the
 * subscription it tries again every 30 s, for a while.
 */
export async function queueLatest(q: JobQueue<CheckJob>, id: string, count: number): Promise<void> {
  await q.add(
    "latest",
    { subscriptionId: id, count },
    { key: `latest|${id}`, attempts: 20, backoff: { type: "fixed", delayMs: LATEST_RETRY_MS } },
  );
}
