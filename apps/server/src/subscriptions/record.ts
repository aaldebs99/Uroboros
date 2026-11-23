import type { Insertable, Transaction } from "kysely";
import type { Database, SubscriptionItemsTable } from "../db/schema.ts";
import { dispatchFor, queueDownload } from "../downloads/dispatch.ts";
import { publishDownloadEvent } from "../downloads/events.ts";
import { getProfile } from "../downloads/profiles.ts";
import type { WorkerDeps } from "../worker/deps.ts";
import type { Candidate } from "./listing.ts";
import type { SubscriptionRow } from "./store.ts";

/** What a check decided for one listed video. */
export type Decision =
  | { c: Candidate; outcome: "queue" | "existing" }
  | { c: Candidate; outcome: "filtered"; reason: string }
  | { c: Candidate; outcome: "waiting"; reason: string; dueAt: Date | null };

type ItemRow = Insertable<SubscriptionItemsTable>;

const item = (subscriptionId: string, c: Candidate) => ({
  subscription_id: subscriptionId,
  extractor: c.extractor,
  video_id: c.videoId,
  title: c.title,
  url: c.url,
});

function itemOf(subscriptionId: string, d: Decision): ItemRow {
  const base = item(subscriptionId, d.c);
  switch (d.outcome) {
    case "existing":
      return { ...base, outcome: "existing", reason: "there when you subscribed" };
    case "filtered":
      return { ...base, outcome: "filtered", reason: d.reason };
    case "waiting":
      return { ...base, outcome: "waiting", reason: d.reason, due_at: d.dueAt };
    case "queue":
      return { ...base, outcome: "queued" };
  }
}

/**
 * Records items, replacing only `waiting` ones (a final outcome is never revisited); a waiting
 * item keeps when it was first seen, which the delay counts from.
 */
async function upsertItems(tx: Transaction<Database>, rows: ItemRow[]): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .insertInto("subscription_items")
    .values(rows)
    .onConflict((oc) =>
      oc
        .columns(["subscription_id", "extractor", "video_id"])
        .doUpdateSet((eb) => ({
          title: eb.ref("excluded.title"),
          outcome: eb.ref("excluded.outcome"),
          reason: eb.ref("excluded.reason"),
          due_at: eb.ref("excluded.due_at"),
          download_id: eb.ref("excluded.download_id"),
        }))
        .where("subscription_items.outcome", "=", "waiting"),
    )
    .execute();
}

/**
 * Records every decision and queues the passing videos in one transaction (a feed on its first
 * check queues at priority 1, behind pasted links), then dispatches for the person. Returns the
 * videos newly queued outside a first check, for the notification.
 */
export async function recordAndQueue(
  deps: WorkerDeps,
  sub: SubscriptionRow,
  decisions: Decision[],
  firstCheckFeeds: ReadonlySet<string>,
): Promise<{ queuedNew: Candidate[] }> {
  const toQueue = decisions.filter((d) => d.outcome === "queue");
  const profile = toQueue.length === 0 ? undefined : await getProfile(deps.db, sub.profile_id);
  if (toQueue.length > 0 && profile === undefined)
    throw new Error("the subscription's profile is gone");
  const result = await deps.db.transaction().execute(async (tx) => {
    const rows: ItemRow[] = [];
    const queuedNew: Candidate[] = [];
    const ids: string[] = [];
    for (const d of decisions) {
      const row = itemOf(sub.id, d);
      if (d.outcome === "queue" && profile !== undefined) {
        const backfill = firstCheckFeeds.has(d.c.feed);
        const out = await queueDownload(tx, {
          userId: sub.user_id,
          requestId: null,
          extractor: d.c.extractor,
          videoId: d.c.videoId,
          url: d.c.url,
          title: d.c.title,
          profile,
          subscriptionId: sub.id,
          priority: backfill ? 1 : 0,
        });
        row.download_id = out.downloadId;
        if (out.downloadId !== null) {
          ids.push(out.downloadId);
          if (!backfill) queuedNew.push(d.c);
        }
      }
      rows.push(row);
    }
    await upsertItems(tx, rows);
    return { queuedNew, ids };
  });
  for (const downloadId of result.ids) {
    await publishDownloadEvent(deps.valkey, deps.prefix, {
      kind: "state",
      downloadId,
      userId: sub.user_id,
    });
  }
  if (result.ids.length > 0) await dispatchFor(deps, sub.user_id);
  return { queuedNew: result.queuedNew };
}
