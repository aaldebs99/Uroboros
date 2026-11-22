import { Worker } from "bullmq";
import type { Job, Processor } from "bullmq";
import type { Redis } from "ioredis";
import { QUEUE_NAMES } from "./queues.ts";
import type { PingResult } from "./queues.ts";

/** Processor of the `system` queue. Only `ping` exists. */
export function systemProcessor(job: Job): Promise<PingResult> {
  if (job.name === "ping") return Promise.resolve({ pong: true });
  return Promise.reject(new Error(`unknown system job "${job.name}"`));
}

export interface SystemWorkerOptions {
  prefix: string;
  concurrency: number;
  /** Test seam: queue name, so tests can use unique queues. Defaults to the real `system` queue. */
  queueName?: string;
  /** Test seam: replaces `systemProcessor`. */
  processor?: Processor;
  /**
   * How often BullMQ looks for stalled jobs, in ms. Production keeps 30 s; tests shorten it.
   * A job is stalled when its worker died and its lock lapsed; it is then run again (up to
   * `maxStalledCount` times), so every processor must be idempotent.
   */
  stalledInterval?: number;
  /** Job lock duration in ms (BullMQ default 30 s). Tests shorten it so a killed worker's job stalls fast. */
  lockDuration?: number;
}

/** Creates the `system` queue worker on `connection` (which must use `maxRetriesPerRequest: null`). */
export function createSystemWorker(connection: Redis, opts: SystemWorkerOptions): Worker {
  return new Worker(opts.queueName ?? QUEUE_NAMES.system, opts.processor ?? systemProcessor, {
    connection,
    prefix: opts.prefix,
    concurrency: opts.concurrency,
    stalledInterval: opts.stalledInterval ?? 30_000,
    maxStalledCount: 2,
    ...(opts.lockDuration === undefined ? {} : { lockDuration: opts.lockDuration }),
  });
}
