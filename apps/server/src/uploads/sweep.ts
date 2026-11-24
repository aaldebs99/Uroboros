import { sql } from "kysely";
import type { DownloadContext } from "../downloads/dispatch.ts";
import type { MediaStore } from "../storage/store.ts";
import { dropStorage, FAILED_OTHERWISE, failUpload, UPLOAD_JOB, uploadJobKey } from "./store.ts";

/** How often the leader looks after uploads (docs/uploads.md). */
export const UPLOAD_SWEEP_EVERY_MS = 60_000;

/**
 * The leader's upload duty: fails an upload processing for over six hours, gives back the job of
 * one processing that lost it (the stall limit can drop a job without its processor running),
 * drops one receiving untouched for a day or whose person is gone, and failed ones after a week
 * (their bytes first, then the row), and forgets done rows after a day (their video stays).
 */
export async function sweepUploads(ctx: DownloadContext, store: MediaStore): Promise<void> {
  /** Runs `fn` for each row on its own: one the store fails stays for the next sweep. */
  const each = async <R extends { id: string }>(rows: R[], fn: (row: R) => Promise<void>) => {
    for (const row of rows) {
      try {
        await fn(row);
      } catch (err) {
        ctx.logger.warn({ err, uploadId: row.id }, "an upload was not swept");
      }
    }
  };
  const stuck = await ctx.db
    .selectFrom("uploads")
    .select("id")
    .where("state", "=", "processing")
    .where("touched_at", "<", sql<Date>`now() - interval '6 hours'`)
    .execute();
  await each(stuck, async ({ id }) => {
    if (await failUpload(ctx.db, store, id, FAILED_OTHERWISE)) {
      ctx.logger.warn({ uploadId: id }, "an upload processed for six hours failed");
    }
  });
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
  await each(lost, async ({ id }) => {
    await ctx.queues.upload.add(
      "upload",
      { uploadId: id },
      { key: uploadJobKey(id), ...UPLOAD_JOB },
    );
  });
  // Abandoned (a day without parts, or the person's account gone) and long-failed uploads: their
  // bytes go first, then the row, so bytes the store keeps stay named for the next sweep.
  const ended = await ctx.db
    .selectFrom("uploads")
    .selectAll()
    .where((eb) =>
      eb.or([
        eb.and([
          eb("state", "=", "receiving"),
          eb("touched_at", "<", sql<Date>`now() - interval '24 hours'`),
        ]),
        eb.and([eb("user_id", "is", null), eb("state", "in", ["receiving", "failed"])]),
        eb.and([
          eb("state", "=", "failed"),
          eb("touched_at", "<", sql<Date>`now() - interval '7 days'`),
        ]),
      ]),
    )
    .execute();
  await each(ended, async (row) => {
    await dropStorage(store, row);
    await ctx.db
      .deleteFrom("uploads")
      .where("id", "=", row.id)
      .where("state", "=", row.state)
      .execute();
  });
  if (ended.length > 0) ctx.logger.info({ ended: ended.length }, "swept ended uploads");
  // A done upload's bytes belong to its media now: only the row goes.
  await ctx.db
    .deleteFrom("uploads")
    .where("state", "=", "done")
    .where("touched_at", "<", sql<Date>`now() - interval '24 hours'`)
    .execute();
}
