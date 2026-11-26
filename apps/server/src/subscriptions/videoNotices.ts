import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import type { JobQueue } from "../jobs/queues.ts";
import { sendNotice } from "../notices/send.ts";
import { failedVideoNotice, newVideoNotice } from "./notices.ts";

/**
 * Announces the subscriptions' new videos among `downloadIds` that are settled (docs/automation.md
 * "Notifications"): "New from <subscription>", opening the video once it is in the library, or
 * Downloads when its download failed for good. A download a check queued as new carries
 * `announce`; clearing it is the claim, so two settles or two replicas send it once.
 */
export async function noticeNewVideos(
  deps: { db: Kysely<Database>; queues: { notify: JobQueue<NotifyJob> } },
  downloadIds: readonly string[],
): Promise<void> {
  if (downloadIds.length === 0) return;
  const claimed = await deps.db
    .updateTable("downloads")
    .set({ announce: false })
    .where("id", "in", downloadIds)
    .where("announce", "=", true)
    .where("state", "in", ["done", "failed"])
    .returning("id")
    .execute();
  if (claimed.length === 0) return;
  const rows = await deps.db
    .selectFrom("downloads as d")
    .innerJoin("subscriptions as s", "s.id", "d.subscription_id")
    .leftJoin("library_entries as e", (j) =>
      j.onRef("e.rendition_id", "=", "d.rendition_id").onRef("e.user_id", "=", "d.user_id"),
    )
    .select([
      "d.id",
      "d.user_id",
      "d.state",
      "d.title",
      "d.video_id",
      "s.id as subscription_id",
      "s.title as subscription_title",
      "s.notify",
      "e.id as entry_id",
    ])
    .where(
      "d.id",
      "in",
      claimed.map((c) => c.id),
    )
    .orderBy("d.created_at")
    .orderBy("d.id")
    .execute();
  for (const r of rows) {
    const sub = { id: r.subscription_id, title: r.subscription_title };
    const video = { downloadId: r.id, title: r.title ?? r.video_id };
    const message =
      r.state === "done" && r.entry_id !== null
        ? newVideoNotice(sub, { ...video, entryId: r.entry_id })
        : failedVideoNotice(sub, video);
    await sendNotice(
      { db: deps.db, notify: deps.queues.notify },
      { userId: r.user_id, kind: "subscriptions", message, urgency: "normal", push: r.notify },
    );
  }
}
