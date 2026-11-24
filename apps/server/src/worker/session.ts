import { DelayedError, type Job } from "bullmq";
import { type BusMessage, isAlive, nextRunToken } from "../transcode/bus.ts";
import type { PlaybackJob } from "../transcode/sessionQueue.ts";
import { LIVE, planOf, type SessionRow } from "../transcode/sessions.ts";
import type { WorkerDeps } from "./deps.ts";
import { DEFAULT_TIMINGS, type LoopEnd, SessionLoop, type SessionTimings } from "./sessionLoop.ts";
import { prepareSource, SessionError } from "./sessionSource.ts";
import { cleanupSession, SessionWriter } from "./sessionWriter.ts";

export type { SessionTimings } from "./sessionLoop.ts";

/** A session cut by shutdown waits this long before another replica takes it. */
const SHUTDOWN_REQUEUE_DELAY_MS = 1000;

/** The job, as much of BullMQ's as the processor uses. */
type PlaybackJobLike = Pick<Job<PlaybackJob>, "data"> & {
  moveToDelayed?: (timestamp: number, token?: string) => Promise<void>;
};

const keysOf = (deps: WorkerDeps) => ({ db: deps.db });

async function liveRow(deps: WorkerDeps, sid: string): Promise<SessionRow | undefined> {
  return deps.db
    .selectFrom("playback_sessions")
    .selectAll()
    .where("id", "=", sid)
    .where("state", "in", LIVE)
    .executeTakeFirst();
}

/** Whether the viewer is still there and the session still live (not stopped, not deleted). */
async function stillWanted(deps: WorkerDeps, sid: string): Promise<boolean> {
  return (await isAlive(keysOf(deps), sid)) && (await liveRow(deps, sid)) !== undefined;
}

/** Records how the session ended, tells waiting requests, and removes its files and keys. */
async function finish(deps: WorkerDeps, sid: string, end: LoopEnd): Promise<void> {
  const failed = end.kind === "failed";
  await deps.db
    .updateTable("playback_sessions")
    .set({
      state: failed ? "failed" : "stopped",
      error_message: failed ? end.error.slice(0, 500) : null,
      stopped_at: new Date(),
    })
    .where("id", "=", sid)
    .where("state", "in", LIVE)
    .execute();
  await deps.playbackBus.publish({ t: "stop", sid });
  await cleanupSession(deps, sid);
  deps.logger.info(
    { sid, end: end.kind, ...(failed ? { error: end.error } : {}) },
    "playback session ended",
  );
}

/** Back to the queue as it was: another replica picks it up, and no attempt is spent. */
async function requeue(
  deps: WorkerDeps,
  job: PlaybackJobLike,
  token: string | undefined,
  sid: string,
) {
  await deps.db
    .updateTable("playback_sessions")
    .set({ state: "queued" })
    .where("id", "=", sid)
    .where("state", "in", ["starting", "running"])
    .execute();
  deps.logger.info({ sid }, "playback session cut by shutdown; requeued");
  if (job.moveToDelayed !== undefined && token !== undefined) {
    await job.moveToDelayed(Date.now() + SHUTDOWN_REQUEUE_DELAY_MS, token);
    throw new DelayedError();
  }
  throw new Error("interrupted by shutdown; retrying");
}

/** Prepares the source and runs the loop, watching for the viewer going and for shutdown. */
async function runSession(
  deps: WorkerDeps,
  row: SessionRow,
  token: string,
  timings: SessionTimings,
  shutdown: AbortSignal,
): Promise<LoopEnd> {
  const preparing = new AbortController();
  let loop: SessionLoop | null = null;
  /** How it ended before the loop took over (a stop or shutdown while preparing). */
  const early: { end: LoopEnd | null } = { end: null };
  const stop = (e: LoopEnd) => {
    early.end ??= e;
    preparing.abort();
    loop?.end(e);
  };
  const pending: BusMessage[] = [];
  const off = deps.playbackBus.on((m) => {
    if (m.sid !== row.id) return;
    if (loop === null) pending.push(m);
    else loop.onMessage(m);
    if (m.t === "stop") stop({ kind: "stopped" });
  });
  const onShutdown = () => {
    stop({ kind: "shutdown" });
  };
  shutdown.addEventListener("abort", onShutdown, { once: true });
  const watch = setInterval(() => {
    stillWanted(deps, row.id)
      .then((wanted) => {
        if (!wanted) stop({ kind: "stopped" });
      })
      // Valkey or Postgres away: one failed look must not stop a session, nor crash the replica.
      .catch((err: unknown) => {
        deps.logger.warn({ err, sid: row.id }, "could not check a playback session's viewer");
      });
  }, timings.aliveCheckMs);
  try {
    if (shutdown.aborted) return { kind: "shutdown" };
    const source = await prepareSource(deps, row, preparing.signal);
    if (early.end !== null) return early.end;
    loop = new SessionLoop({
      deps,
      row,
      plan: planOf(row),
      source,
      writer: new SessionWriter(deps, row.id, token),
      timings,
    });
    for (const m of pending) loop.onMessage(m);
    return await loop.run();
  } catch (err) {
    if (early.end !== null) return early.end;
    if (!(err instanceof SessionError))
      deps.logger.error({ err, sid: row.id }, "playback session broke");
    return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
  } finally {
    off();
    clearInterval(watch);
    shutdown.removeEventListener("abort", onShutdown);
  }
}

/**
 * The `playback` queue's consumer (docs/transcoding.md): one job per session, running until the
 * viewer goes, the session is stopped, or it fails. A session cut by shutdown goes back to the
 * queue for another replica.
 */
export function sessionProcessor(
  deps: WorkerDeps,
  shutdown: AbortSignal,
  timings: Partial<SessionTimings> = {},
) {
  const t: SessionTimings = { ...DEFAULT_TIMINGS, ...timings };
  return async (job: PlaybackJobLike, lockToken?: string): Promise<void> => {
    const sid = job.data.sessionId;
    const row = await liveRow(deps, sid);
    if (row === undefined) return;
    if (!(await isAlive(keysOf(deps), sid))) {
      await finish(deps, sid, { kind: "stopped" });
      return;
    }
    const token = await nextRunToken(keysOf(deps), sid);
    // Gone since the look above (deleted with its entry or link): nothing to run.
    if (token === null) return;
    await deps.db
      .updateTable("playback_sessions")
      .set({ state: "starting" })
      .where("id", "=", sid)
      .where("state", "=", "queued")
      .execute();
    const end = await runSession(deps, row, token, t, shutdown);
    if (end.kind === "shutdown") return requeue(deps, job, lockToken, sid);
    if (end.kind === "fenced") return;
    await finish(deps, sid, end);
  };
}
