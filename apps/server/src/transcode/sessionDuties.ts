import { sql } from "kysely";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { forgetSession, isAlive } from "./bus.ts";
import { addPlaybackJob } from "./sessionQueue.ts";
import { LIVE, sessionPrefix } from "./sessions.ts";

export const SESSION_DUTY_EVERY_MS = 60_000;
/** A session this young may still be starting its job, so it is left alone. */
const STARTING_MS = 2 * 60_000;
/** Ended sessions are kept this long (a page may still ask how its session ended). */
const ENDED_KEEP_MS = 60 * 60_000;

const ago = (ms: number) => sql<Date>`now() - make_interval(secs => ${ms / 1000})`;

/**
 * The leader's playback duty (docs/transcoding.md), every minute: a live session whose run is gone
 * (a replica that died) gets it back while its viewer is there, and is stopped,
 * its folder trashed, once they are not; ended sessions are forgotten after an hour (the trigger
 * on the table trashes each folder, should a runner have died before its cleanup).
 */
export async function reconcileSessions(
  ctx: DownloadContext,
): Promise<{ readded: number; stopped: number; swept: number }> {
  const keys = { db: ctx.db };
  // Live sessions whose run is gone (the replica running it died, or its job stalled too often).
  const live = await ctx.db
    .selectFrom("playback_sessions as s")
    .select("s.id")
    .where("s.state", "in", LIVE)
    .where("s.created_at", "<", ago(STARTING_MS))
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("jobs")
            .select("jobs.id")
            .where("jobs.queue", "=", "playback")
            .whereRef("jobs.key", "=", sql<string>`'playback|' || s.id`),
        ),
      ),
    )
    .execute();
  let readded = 0;
  let stopped = 0;
  for (const { id } of live) {
    if (await isAlive(keys, id)) {
      await addPlaybackJob(ctx.queues.playback, id);
      readded++;
      continue;
    }
    await ctx.db
      .updateTable("playback_sessions")
      .set({ state: "stopped", stopped_at: new Date() })
      .where("id", "=", id)
      .where("state", "in", LIVE)
      .execute();
    await ctx.db
      .insertInto("storage_trash")
      .values({ key: sessionPrefix(id) })
      .onConflict((oc) => oc.column("key").doNothing())
      .execute();
    await forgetSession(keys, id);
    stopped++;
  }
  const swept = await ctx.db
    .deleteFrom("playback_sessions")
    .where("state", "in", ["stopped", "failed"])
    .where("stopped_at", "<", ago(ENDED_KEEP_MS))
    .executeTakeFirst();
  return { readded, stopped, swept: Number(swept.numDeletedRows) };
}
