import type { Insertable, Transaction } from "kysely";
import type { Database, SubscriptionItemsTable } from "../db/schema.ts";
import { dispatchFor, queueDownload } from "../downloads/dispatch.ts";
import { publishDownloadEvent } from "../downloads/events.ts";
import { getProfile } from "../downloads/profiles.ts";
import type { WorkerDeps } from "../worker/deps.ts";
import { withLoginsOf } from "../worker/logins.ts";
import { freeLease, takeLease } from "./lease.ts";
import { candidateKey, listFeed, type Candidate } from "./listing.ts";
import type { CheckJob } from "./queue.ts";
import type { SubscriptionRow } from "./store.ts";

/** Thrown while a check holds the subscription: BullMQ tries the job again shortly. */
export class SubscriptionBusy extends Error {
  override readonly name = "SubscriptionBusy";
}

/**
 * The videos to fetch: a channel's newest `count` of each followed tab (a tab lists newest first),
 * a playlist's last `count` entries (where additions go); each video once.
 */
async function latestOf(deps: WorkerDeps, sub: SubscriptionRow, count: number) {
  const picked = new Map<string, Candidate>();
  for (const feed of sub.feeds) {
    const listed =
      sub.kind === "playlist"
        ? (await listFeed(deps, feed)).entries.slice(-count)
        : (await listFeed(deps, feed, undefined, count)).entries;
    for (const c of listed) picked.set(candidateKey(c), c);
  }
  return [...picked.values()];
}

type ItemRow = Insertable<SubscriptionItemsTable>;

/** Records the video as queued whatever it was before (asked for, it is no longer held back). */
async function recordQueued(tx: Transaction<Database>, row: ItemRow): Promise<void> {
  await tx
    .insertInto("subscription_items")
    .values(row)
    .onConflict((oc) =>
      oc.columns(["subscription_id", "extractor", "video_id"]).doUpdateSet({
        title: row.title,
        outcome: "queued",
        reason: null,
        due_at: null,
        download_id: row.download_id,
        backfill: false,
      }),
    )
    .execute();
}

/**
 * Queues `videos` for the owner at the priority of a pasted link, past the filters and the wait,
 * and dispatches. A video the person already has, or is already getting, gets no new download.
 */
async function queueAll(deps: WorkerDeps, sub: SubscriptionRow, videos: Candidate[]) {
  if (videos.length === 0) return;
  const profile = await getProfile(deps.db, sub.profile_id);
  if (profile === undefined) throw new Error("the subscription's profile is gone");
  const ids = await deps.db.transaction().execute(async (tx) => {
    const queued: string[] = [];
    for (const c of videos) {
      const out = await queueDownload(tx, {
        userId: sub.user_id,
        requestId: null,
        extractor: c.extractor,
        videoId: c.videoId,
        url: c.url,
        title: c.title,
        profile,
        subscriptionId: sub.id,
        priority: 0,
      });
      await recordQueued(tx, {
        subscription_id: sub.id,
        extractor: c.extractor,
        video_id: c.videoId,
        title: c.title,
        url: c.url,
        outcome: "queued",
        download_id: out.downloadId,
        backfill: false,
      });
      if (out.downloadId !== null) queued.push(out.downloadId);
    }
    return queued;
  });
  for (const downloadId of ids) {
    await publishDownloadEvent(deps.db, {
      kind: "state",
      downloadId,
      userId: sub.user_id,
    });
  }
  if (ids.length > 0) await dispatchFor(deps, sub.user_id);
}

/**
 * The `automation` queue's `latest` job (docs/automation.md): takes the subscription like a check,
 * lists each feed (signed in as its owner) and queues the latest videos. A paused subscription, or
 * a gone one or owner, is left alone; one a check is holding is tried again later.
 */
export function latestProcessor(deps: WorkerDeps) {
  return async (job: { data: CheckJob }): Promise<void> => {
    const { subscriptionId, count = 1 } = job.data;
    const sub = await takeLease(deps.db, subscriptionId);
    if (sub === undefined) {
      const held = await deps.db
        .selectFrom("subscriptions")
        .select("id")
        .where("id", "=", subscriptionId)
        .where("enabled", "=", true)
        .where("lease_until", ">", new Date())
        .executeTakeFirst();
      if (held !== undefined) throw new SubscriptionBusy("a check is running; trying again");
      return;
    }
    try {
      const signedIn = await withLoginsOf(deps, sub.user_id);
      await queueAll(deps, sub, await latestOf(signedIn, sub, count));
    } finally {
      await freeLease(deps.db, sub.id);
    }
  };
}
