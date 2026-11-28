import type { DownloadBatch } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { dispatchFor, stopFetchIfUnwanted, type DownloadContext } from "./dispatch.ts";
import { publishDownloadEvent } from "./events.ts";

/**
 * A pasted playlist or channel as a whole (docs/downloads.md "Cancelling a playlist"): thrown away
 * before its pick, or the rest of its videos cancelled together once queued. Only the person who
 * pasted it does either, as only they see it waiting for its pick.
 */

/** The request's state, or 404 when it isn't the person's. */
async function stateOf(db: Kysely<Database>, userId: string, id: string): Promise<string> {
  const row = await db
    .selectFrom("download_requests")
    .select("state")
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (row === undefined) throw new ApiError("not_found", "no such request");
  return row.state;
}

/**
 * Deletes a playlist or channel still waiting for its pick, so it leaves Ready to pick at once
 * rather than a day later; nothing of it was queued. Any other state is a conflict: a probe still
 * looking at the link would write into a missing row, and a queued one has videos of its own.
 */
export async function discardRequest(
  db: Kysely<Database>,
  userId: string,
  id: string,
): Promise<void> {
  const gone = await db
    .deleteFrom("download_requests")
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .where("state", "=", "choosing")
    .executeTakeFirst();
  if (gone.numDeletedRows === 0n) {
    await stateOf(db, userId, id);
    throw new ApiError("conflict", "only a playlist waiting for its pick can be discarded");
  }
  await publishDownloadEvent(db, { kind: "requests", userId });
}

/**
 * The person's queued playlists and channels with videos still queued or downloading, newest
 * first: a single video or a search's results are not batches.
 */
export async function listBatches(db: Kysely<Database>, userId: string): Promise<DownloadBatch[]> {
  const count = (state: "done" | "failed") =>
    sql<number>`count(*) FILTER (WHERE d.state = ${state})::int`;
  const rows = await db
    .selectFrom("download_requests as r")
    .innerJoin("downloads as d", "d.request_id", "r.id")
    .select([
      "r.id",
      "r.url",
      "r.title",
      "r.kind",
      sql<number>`count(*) FILTER (WHERE d.state IN ('queued', 'running'))::int`.as("waiting"),
      count("done").as("done"),
      count("failed").as("failed"),
    ])
    .where("r.user_id", "=", userId)
    .where("r.state", "=", "queued")
    .where("r.intent", "=", "download")
    .where("r.kind", "in", ["playlist", "channel"])
    .groupBy(["r.id", "r.url", "r.title", "r.kind", "r.created_at"])
    .having(sql<boolean>`count(*) FILTER (WHERE d.state IN ('queued', 'running')) > 0`)
    .orderBy("r.created_at", "desc")
    .orderBy("r.id", "desc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    title: r.title,
    kind: r.kind === "channel" ? "channel" : "playlist",
    waiting: r.waiting,
    done: r.done,
    failed: r.failed,
  }));
}

/**
 * Cancels every video of a queued playlist or channel still queued or downloading, in one
 * statement, then stops each fetch nobody else waits on and dispatches the person's next ones.
 * Done and failed videos stay; a cancelled one can be retried on its own.
 */
export async function cancelBatch(
  ctx: DownloadContext,
  userId: string,
  id: string,
): Promise<{ cancelled: number }> {
  if ((await stateOf(ctx.db, userId, id)) !== "queued") {
    throw new ApiError("conflict", "only a queued playlist's videos can be cancelled together");
  }
  const rows = await ctx.db
    .updateTable("downloads")
    .set({ state: "cancelled", finished_at: new Date() })
    .where("request_id", "=", id)
    .where("user_id", "=", userId)
    .where("state", "in", ["queued", "running"])
    .returning("fetch_key")
    .execute();
  for (const key of new Set(rows.map((r) => r.fetch_key))) await stopFetchIfUnwanted(ctx, key);
  // One event for the lot: the person's tabs fetch their lists again (one per video would be
  // hundreds for a long playlist).
  await publishDownloadEvent(ctx.db, { kind: "requests", userId });
  await dispatchFor(ctx, userId);
  return { cancelled: rows.length };
}
