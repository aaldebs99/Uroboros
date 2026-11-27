import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { sql, type Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import type { LeaderStatus } from "../shared/leader.ts";
import type { MediaStore } from "../storage/store.ts";

/**
 * Each replica checks in for Admin › Health (docs/health.md): once it has attached its database,
 * at once and every 15 s, it writes its row in `replicas` (its host and pid, as `jobs.worker` names
 * them, its version, whether it leads, and the checks of its own that fail: its store answering),
 * and drops rows nobody has written for an hour. A clean stop deletes its row. The page reads a row
 * unseen for 45 s as a replica that no longer answers.
 */

/** How often a replica checks in. */
export const BEAT_MS = 15_000;
/** How long without a check-in before Admin › Health says a replica isn't answering. */
export const QUIET_MS = 3 * BEAT_MS;
/** How long a replica's row outlives its last check-in. */
const FORGET_AFTER_S = 3600;
/** How long a check may take; a stop waits twice that for the check-in underway and its delete. */
const CHECK_MS = 2000;
/** The key the storage check asks about; it never exists, so the answer is only "reachable". */
const STORAGE_PROBE_KEY = "health-check";

/** Who this replica is: a random id for this process, its host and pid, and when it started. */
export interface Replica {
  id: string;
  host: string;
  pid: number;
  startedAt: Date;
}

export const newReplica = (): Replica => ({
  id: randomUUID(),
  host: hostname(),
  pid: process.pid,
  startedAt: new Date(),
});

export interface HeartbeatDeps {
  db: Kysely<Database>;
  store: Pick<MediaStore, "stat" | "localPath">;
  leader: Pick<LeaderStatus, "leading" | "onChange">;
  version: string;
  logger: Logger;
  /** How long a check may take (tests shorten it). */
  checkMs?: number;
}

/** Whether `work` settles, without throwing, within `ms`. */
async function answers(work: () => Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, ms);
  });
  try {
    return await Promise.race([work().then(() => true), late]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether the store answers: S3 says a key it doesn't hold is missing; a filesystem store's folder
 * must be there (a missing key under a folder that's gone looks just as missing).
 */
async function checkStorage(store: HeartbeatDeps["store"]): Promise<void> {
  const local = store.localPath(STORAGE_PROBE_KEY);
  if (local === null) {
    await store.stat(STORAGE_PROBE_KEY);
    return;
  }
  if (!(await stat(dirname(local))).isDirectory()) throw new Error("the storage root is no folder");
}

/**
 * One check-in: runs the replica's own checks, writes its row (unless `live` says the replica
 * stopped meanwhile), and forgets long-quiet replicas.
 */
export async function beat(
  deps: HeartbeatDeps,
  self: Replica,
  live: () => boolean = () => true,
): Promise<void> {
  const storageOk = await answers(() => checkStorage(deps.store), deps.checkMs ?? CHECK_MS);
  if (!live()) return;
  const row = {
    version: deps.version,
    leader: deps.leader.leading,
    failing: storageOk ? [] : ["storage"],
    seen_at: sql<Date>`now()`,
  };
  await deps.db
    .insertInto("replicas")
    .values({ id: self.id, host: self.host, pid: self.pid, started_at: self.startedAt, ...row })
    .onConflict((oc) => oc.column("id").doUpdateSet(row))
    .execute();
  await deps.db
    .deleteFrom("replicas")
    .where("seen_at", "<", sql<Date>`now() - make_interval(secs => ${FORGET_AFTER_S})`)
    .execute();
}

/**
 * Checks in now, every 15 s and whenever it starts or stops leading, until `signal` aborts; then
 * deletes this replica's row (bounded) and resolves. Check-ins run one after another, so none can
 * write the row after the stop's delete. A failed check-in is logged, never thrown.
 */
export function startHeartbeat(
  deps: HeartbeatDeps,
  self: Replica,
  signal: AbortSignal,
): Promise<void> {
  const checkMs = deps.checkMs ?? CHECK_MS;
  let current: Promise<void> = Promise.resolve();
  const once = () => {
    current = current.then(() =>
      beat(deps, self, () => !signal.aborted).catch((err: unknown) => {
        deps.logger.warn({ err }, "checking in for Admin › Health failed");
      }),
    );
  };
  once();
  const every = setInterval(once, BEAT_MS);
  every.unref();
  deps.leader.onChange(() => {
    if (!signal.aborted) once();
  });
  return new Promise<void>((resolve) => {
    const stop = () => {
      clearInterval(every);
      const leave = current.then(() =>
        deps.db.deleteFrom("replicas").where("id", "=", self.id).execute(),
      );
      // The check-in underway finishes its checks without writing, then the row goes.
      void answers(() => leave, 2 * checkMs).then(() => {
        resolve();
      });
    };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
}
