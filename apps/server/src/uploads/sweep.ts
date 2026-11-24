import { sql } from "kysely";
import type { DownloadContext } from "../downloads/dispatch.ts";
import type { MediaStore } from "../storage/store.ts";
import { dropStorage, FAILED_OTHERWISE, failUpload, UPLOAD_JOB, uploadJobKey } from "./store.ts";

/** How often the leader looks after uploads (docs/uploads.md). */
export const UPLOAD_SWEEP_EVERY_MS = 60_000;

/**
 * The leader's upload duty: fails an upload processing for over six hours, gives back the job of
 * one processing that lost it (the stall limit can drop a job without its processor running),
 * drops one receiving untouched for a day or whose person is gone (its bytes with it), and
 * forgets done rows after a day (their video stays) and failed ones after a week.
 */
export async function sweepUploads(ctx: DownloadContext, store: MediaStore): Promise<void> {
  const stuck = await ctx.db
    .selectFrom("uploads")
    .select("id")
    .where("state", "=", "processing")
    .where("touched_at", "<", sql<Date>`now() - interval '6 hours'`)
    .execute();
  for (const { id } of stuck) {
    if (await failUpload(ctx.db, store, id, FAILED_OTHERWISE)) {
      ctx.logger.warn({ uploadId: id }, "an upload processed for six hours failed");
    }
  }
  const lost = await ctx.db
    .selectFrom("uploads as u")
    .select("u.id")
    .where("u.state", "=", "processing")
    .where("u.user_id", "is not", null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("jobs as j")
            .select("j.id")
            .where("j.queue", "=", "upload")
            .whereRef("j.key", "=", sql`'upload|' || u.id`),
        ),
      ),
    )
    .execute();
  for (const { id } of lost) {
    await ctx.queues.upload.add(
      "upload",
      { uploadId: id },
      { key: uploadJobKey(id), ...UPLOAD_JOB },
    );
  }
  const dropped = await ctx.db
    .deleteFrom("uploads")
    .where((eb) =>
      eb.or([
        eb.and([
          eb("state", "=", "receiving"),
          eb("touched_at", "<", sql<Date>`now() - interval '24 hours'`),
        ]),
        eb.and([eb("user_id", "is", null), eb("state", "!=", "done")]),
      ]),
    )
    .returningAll()
    .execute();
  for (const row of dropped) {
    if (row.state === "failed") {
      if (row.thumbnail_key !== null) await store.delete(row.thumbnail_key);
    } else {
      await dropStorage(store, row);
    }
  }
  if (dropped.length > 0) ctx.logger.info({ dropped: dropped.length }, "dropped abandoned uploads");
  await ctx.db
    .deleteFrom("uploads")
    .where((eb) =>
      eb.or([
        eb.and([
          eb("state", "=", "done"),
          eb("touched_at", "<", sql<Date>`now() - interval '24 hours'`),
        ]),
        eb.and([
          eb("state", "=", "failed"),
          eb("touched_at", "<", sql<Date>`now() - interval '7 days'`),
        ]),
      ]),
    )
    .execute();
}
