import type { ItemDownloadBody, QueueSelectionResult } from "@uroboros/contract";
import { ApiError } from "../api/errors.ts";
import { dispatchFor, queueDownload, type DownloadContext } from "../downloads/dispatch.ts";
import { publishDownloadEvent } from "../downloads/events.ts";
import { getProfile } from "../downloads/profiles.ts";
import { ownSubscription } from "./store.ts";

/**
 * Downloads one video from a subscription's activity now: one it skipped (there when subscribing),
 * filtered or is still waiting on, in the subscription's format, at a pasted link's priority. The
 * item turns `queued`, so checks leave it alone. No yt-dlp here: the item already has the video's
 * link and id, and the fetch job probes the rest. One the person already has, or is getting,
 * counts as skipped.
 */
export async function downloadItem(
  ctx: DownloadContext,
  userId: string,
  subscriptionId: string,
  body: ItemDownloadBody,
): Promise<QueueSelectionResult> {
  const sub = await ownSubscription(ctx.db, userId, subscriptionId);
  const item = await ctx.db
    .selectFrom("subscription_items")
    .select(["extractor", "video_id", "title", "url"])
    .where("subscription_id", "=", sub.id)
    .where("extractor", "=", body.extractor)
    .where("video_id", "=", body.videoId)
    .executeTakeFirst();
  if (item === undefined) throw new ApiError("not_found", "the subscription never saw that video");
  const profile = await getProfile(ctx.db, sub.profile_id);
  if (profile === undefined) throw new ApiError("conflict", "the subscription's format is gone");
  const downloadId = await ctx.db.transaction().execute(async (tx) => {
    const out = await queueDownload(tx, {
      userId,
      requestId: null,
      extractor: item.extractor,
      videoId: item.video_id,
      url: item.url,
      title: item.title,
      profile,
      subscriptionId: sub.id,
      priority: 0,
    });
    await tx
      .updateTable("subscription_items")
      .set({
        outcome: "queued",
        reason: null,
        due_at: null,
        backfill: false,
        ...(out.downloadId === null ? {} : { download_id: out.downloadId }),
      })
      .where("subscription_id", "=", sub.id)
      .where("extractor", "=", item.extractor)
      .where("video_id", "=", item.video_id)
      .execute();
    return out.downloadId;
  });
  if (downloadId === null) return { queued: 0, skipped: 1 };
  await publishDownloadEvent(ctx.valkey, ctx.prefix, { kind: "state", downloadId, userId });
  await dispatchFor(ctx, userId);
  return { queued: 1, skipped: 0 };
}
