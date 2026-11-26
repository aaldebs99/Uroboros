import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { periodicDuty } from "../shared/periodic.ts";
import { stallBack } from "./store.ts";

/** How often the leader looks for runs whose worker vanished. */
export const STALL_SWEEP_EVERY_MS = 15_000;

/**
 * Puts back every job whose run's lease lapsed (its worker crashed or hung): the run's attempt
 * is given back and a stall counted, and a job past its queue's stalls is
 * dropped. A leader duty.
 */
export async function recoverStalled(
  db: Kysely<Database>,
  logger: Logger,
): Promise<{ requeued: number; dropped: number }> {
  const stalled = await stallBack(db);
  let dropped = 0;
  for (const s of stalled) {
    const job = { queue: s.queue, name: s.name, key: s.key };
    if (s.outcome === "dropped") {
      dropped++;
      logger.warn(job, "a job's worker vanished once too often; dropped");
    } else logger.info(job, "a job whose worker vanished went back to its queue");
  }
  return { requeued: stalled.length - dropped, dropped };
}

/** The leader's stall sweep, every 15 s while it leads. */
export function stallDuty(db: Kysely<Database>, logger: Logger) {
  return periodicDuty(
    "job stall sweep",
    STALL_SWEEP_EVERY_MS,
    () => recoverStalled(db, logger),
    logger,
  );
}
