import { sql } from "kysely";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { addTranscodeJob } from "./queue.ts";

/** A copy asked about within this long counts as wanted. */
const WANTED_MS = 10 * 60_000;
/** A run this recent may still be starting its job, so it is left alone. */
const STARTING_MS = 2 * 60_000;
export const TRANSCODE_RECONCILE_EVERY_MS = 60_000;

/**
 * Re-adds the job of a copy that should have one and does not (a replica that died mid-run, a
 * flushed Valkey): a queued copy someone asked about in the last 10 minutes, or a running one
 * started more than 2 minutes ago. Returns how many it re-added.
 */
export async function reconcileTranscodes(ctx: DownloadContext): Promise<number> {
  const rows = await ctx.db
    .selectFrom("transcodes")
    .select("id")
    .where((eb) =>
      eb.or([
        eb.and([
          eb("state", "=", "queued"),
          eb("last_used_at", ">", sql<Date>`now() - make_interval(secs => ${WANTED_MS / 1000})`),
        ]),
        eb.and([
          eb("state", "=", "running"),
          eb("started_at", "<", sql<Date>`now() - make_interval(secs => ${STARTING_MS / 1000})`),
        ]),
      ]),
    )
    .execute();
  let added = 0;
  for (const { id } of rows) {
    if ((await ctx.queues.transcode.getJob(`transcode|${id}`)) !== undefined) continue;
    await addTranscodeJob(ctx.queues.transcode, id);
    added++;
  }
  return added;
}
