import type { Redis } from "ioredis";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import type { Principal } from "../auth/guard.ts";
import { lockKey } from "../shared/lockKeys.ts";
import type { DownloadLimits } from "../storage/config.ts";
import { publishCancel, publishDownloadEvent } from "./events.ts";
import { fetchKey } from "./fetchKey.ts";
import { argsOf, type ProfileArgs, type ProfileRow } from "./profiles.ts";
import type { DownloadQueues, FetchJob } from "./queues.ts";

/** What queueing, dispatching and cancelling need, in the api and in workers alike. */
export interface DownloadContext {
  db: Kysely<Database>;
  /** For events and cancels (a normal command connection). */
  valkey: Redis;
  /** The BullMQ and event key prefix. */
  prefix: string;
  queues: DownloadQueues;
  limits: DownloadLimits;
  logger: Logger;
}

const ACTIVE = ["queued", "running"] as const;
const FETCH_ATTEMPTS = 3;
const BACKOFF_MS = 30_000;

export interface QueueInput {
  userId: string;
  requestId: string | null;
  extractor: string;
  videoId: string;
  url: string;
  title: string | null;
  profile: ProfileRow;
}

export type QueueOutcome = "done" | "queued" | "skipped";

async function storedRendition(
  tx: Transaction<Database>,
  extractor: string,
  videoId: string,
  profile: ProfileRow,
): Promise<{ id: string; media_id: string } | undefined> {
  return tx
    .selectFrom("renditions as r")
    .innerJoin("media as m", "m.id", "r.media_id")
    .select(["r.id", "r.media_id"])
    .where("m.extractor", "=", extractor)
    .where("m.video_id", "=", videoId)
    .where("r.profile_id", "=", profile.id)
    .where("r.profile_revision", "=", profile.revision)
    .executeTakeFirst();
}

/**
 * Records one download for a person: `skipped` if they already have it or are already getting
 * it, `done` (with a library entry) if the rendition is stored, otherwise `queued` to wait for a
 * dispatch slot. The profile's arguments are snapshotted on the row.
 */
export async function queueDownload(
  tx: Transaction<Database>,
  input: QueueInput,
): Promise<{ outcome: QueueOutcome; downloadId: string | null }> {
  const extractor = input.extractor.toLowerCase();
  const key = fetchKey(extractor, input.videoId, input.profile.id, input.profile.revision);
  const active = await tx
    .selectFrom("downloads")
    .select("id")
    .where("user_id", "=", input.userId)
    .where("fetch_key", "=", key)
    .where("state", "in", ACTIVE)
    .executeTakeFirst();
  if (active !== undefined) return { outcome: "skipped", downloadId: null };
  const stored = await storedRendition(tx, extractor, input.videoId, input.profile);
  if (stored !== undefined) {
    const entry = await tx
      .insertInto("library_entries")
      .values({ user_id: input.userId, media_id: stored.media_id, rendition_id: stored.id })
      .onConflict((oc) => oc.columns(["user_id", "rendition_id"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (entry === undefined) return { outcome: "skipped", downloadId: null };
  }
  const row = await tx
    .insertInto("downloads")
    .values({
      user_id: input.userId,
      request_id: input.requestId,
      profile_id: input.profile.id,
      profile_revision: input.profile.revision,
      args: JSON.stringify(argsOf(input.profile)),
      extractor,
      video_id: input.videoId,
      url: input.url,
      title: input.title,
      fetch_key: key,
      ...(stored === undefined
        ? {}
        : { state: "done" as const, rendition_id: stored.id, finished_at: new Date() }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { outcome: stored === undefined ? "queued" : "done", downloadId: row.id };
}

/** A download row's fetch, as a job: everything a worker needs is on the row (the snapshot). */
export interface FetchRow {
  fetch_key: string;
  extractor: string;
  video_id: string;
  url: string;
  profile_id: string;
  profile_revision: string;
  args: unknown;
  profile_name: string;
}

/** Adds the fetch job for `r` (ignored by BullMQ while a job with that id is live). */
export async function addFetchJob(ctx: DownloadContext, r: FetchRow): Promise<void> {
  const job: FetchJob = {
    fetchKey: r.fetch_key,
    extractor: r.extractor,
    videoId: r.video_id,
    url: r.url,
    profileId: r.profile_id,
    profileName: r.profile_name,
    revision: r.profile_revision,
    args: r.args as ProfileArgs,
  };
  await ctx.queues.download.add("fetch", job, {
    jobId: r.fetch_key,
    attempts: FETCH_ATTEMPTS,
    backoff: { type: "exponential", delay: BACKOFF_MS },
    removeOnComplete: true,
    removeOnFail: true,
  });
}

/**
 * Dispatches a person's oldest waiting downloads until they have `maxActivePerUser` dispatched, under a
 * per-user transaction lock so concurrent calls never over-dispatch. Each dispatch adds the fetch
 * job inside the transaction (a failed add rolls the dispatch back); BullMQ ignores a second add of
 * a live job id, so a shared fetch is fetched once. Returns how many were dispatched.
 */
export async function dispatchFor(ctx: DownloadContext, userId: string): Promise<number> {
  const picked = await ctx.db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(${lockKey("DOWN", userId)})`.execute(tx);
    const { n } = await tx
      .selectFrom("downloads")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("user_id", "=", userId)
      .where("state", "in", ACTIVE)
      .where("dispatched_at", "is not", null)
      .executeTakeFirstOrThrow();
    const free = ctx.limits.maxActivePerUser - Number(n);
    if (free <= 0) return [];
    const rows = await tx
      .selectFrom("downloads as d")
      .innerJoin("format_profiles as p", "p.id", "d.profile_id")
      .select([
        "d.id",
        "d.fetch_key",
        "d.extractor",
        "d.video_id",
        "d.url",
        "d.profile_id",
        "d.profile_revision",
        "d.args",
        "p.name as profile_name",
      ])
      .where("d.user_id", "=", userId)
      .where("d.state", "=", "queued")
      .where("d.dispatched_at", "is", null)
      .orderBy("d.created_at")
      .orderBy("d.id")
      .limit(free)
      .execute();
    if (rows.length === 0) return [];
    await tx
      .updateTable("downloads")
      .set({ dispatched_at: new Date() })
      .where(
        "id",
        "in",
        rows.map((r) => r.id),
      )
      .execute();
    for (const r of rows) await addFetchJob(ctx, r);
    return rows;
  });
  return picked.length;
}

/** A download the principal may act on: their own, or anyone's for an admin; else 404. */
export async function findDownload(db: Kysely<Database>, principal: Principal, id: string) {
  const row = await db
    .selectFrom("downloads")
    .selectAll()
    .where("id", "=", id)
    .$if(principal.role !== "admin", (qb) => qb.where("user_id", "=", principal.userId))
    .executeTakeFirst();
  if (row === undefined) throw new ApiError("not_found", "no such download");
  return row;
}

/** Stops the fetch for `key` when no active download waits on it any more. */
async function stopFetchIfUnwanted(ctx: DownloadContext, key: string): Promise<void> {
  const waiting = await ctx.db
    .selectFrom("downloads")
    .select("id")
    .where("fetch_key", "=", key)
    .where("state", "in", ACTIVE)
    .executeTakeFirst();
  if (waiting !== undefined) return;
  const job = await ctx.queues.download.getJob(key);
  if (job === undefined) return;
  const state = await job.getState();
  if (state === "active") await publishCancel(ctx.valkey, ctx.prefix, key);
  else if (state === "waiting" || state === "delayed" || state === "prioritized") {
    await job.remove().catch((err: unknown) => {
      // It may have just started: then the cancel reaches it.
      ctx.logger.warn(
        { err, key },
        "removing a waiting fetch failed; asking the worker to stop it",
      );
      return publishCancel(ctx.valkey, ctx.prefix, key);
    });
  }
}

export async function cancelDownload(
  ctx: DownloadContext,
  principal: Principal,
  id: string,
): Promise<void> {
  const row = await findDownload(ctx.db, principal, id);
  const updated = await ctx.db
    .updateTable("downloads")
    .set({ state: "cancelled", finished_at: new Date() })
    .where("id", "=", id)
    .where("state", "in", ACTIVE)
    .returning("id")
    .executeTakeFirst();
  if (updated === undefined) throw new ApiError("conflict", "this download is not active");
  await stopFetchIfUnwanted(ctx, row.fetch_key);
  await publishDownloadEvent(ctx.valkey, ctx.prefix, {
    kind: "state",
    downloadId: id,
    userId: row.user_id,
  });
  await dispatchFor(ctx, row.user_id);
}

export async function retryDownload(
  ctx: DownloadContext,
  principal: Principal,
  id: string,
): Promise<void> {
  const row = await findDownload(ctx.db, principal, id);
  if (row.state !== "failed" && row.state !== "cancelled") {
    throw new ApiError("conflict", "only a failed or cancelled download can be retried");
  }
  try {
    await ctx.db
      .updateTable("downloads")
      .set({
        state: "queued",
        dispatched_at: null,
        error_kind: null,
        error_message: null,
        stderr_tail: [],
        attempts: 0,
        started_at: null,
        finished_at: null,
      })
      .where("id", "=", id)
      .execute();
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new ApiError("conflict", "this video is already being downloaded");
    }
    throw err;
  }
  await publishDownloadEvent(ctx.valkey, ctx.prefix, {
    kind: "state",
    downloadId: id,
    userId: row.user_id,
  });
  await dispatchFor(ctx, row.user_id);
}
