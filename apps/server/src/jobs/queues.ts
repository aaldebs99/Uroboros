/**
 * The job queues (docs/jobs.md): jobs are rows in `jobs`, added here and run by `startJobWorker`.
 * A job may carry a key: a second job with the key of a live (waiting or running) one is refused,
 * which is how two people asking for the same video share one download.
 */
import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

export interface QueueSpec {
  /** How long a run holds its job between renewals; a worker renews it every half lease. */
  leaseMs: number;
  /** Runs of one job whose worker vanished, put back before the job is dropped. */
  maxStalls: number;
  /** At most one job starts per this many ms, across every replica. */
  startEveryMs?: number;
}

export const QUEUES = {
  probe: { leaseMs: 30_000, maxStalls: 1 },
  download: { leaseMs: 60_000, maxStalls: 2 },
  notify: { leaseMs: 30_000, maxStalls: 1 },
  playback: { leaseMs: 60_000, maxStalls: 1 },
  automation: { leaseMs: 30_000, maxStalls: 1, startEveryMs: 2000 },
  upload: { leaseMs: 60_000, maxStalls: 2 },
} as const satisfies Record<string, QueueSpec>;

export type QueueName = keyof typeof QUEUES;

export interface AddOptions {
  /** Refuses the job while another with this key is live. */
  key?: string;
  delayMs?: number;
  /** Runs before the job is dropped as failed. Default 1. */
  attempts?: number;
  /** The wait before a retry: fixed, or doubling from `delayMs` with each failed run. */
  backoff?: { type: "fixed" | "exponential"; delayMs: number };
}

/** A running job, as its processor sees it. */
export interface Job<T> {
  id: string;
  queue: QueueName;
  name: string;
  key: string | null;
  data: T;
  /** Runs of this job that failed before this one. */
  attemptsMade: number;
  opts: { attempts: number };
  /**
   * Aborts when this run no longer holds the job (its lease lapsed and the job went back to its
   * queue): the run should stop, since whatever it records now is dropped.
   */
  signal: AbortSignal;
}

/** Runs one job; resolves when it is done, throws to retry, fail or go back (errors.ts). */
export type Processor<T> = (job: Job<T>) => Promise<void>;

export interface QueuedJob<T> {
  state: "queued" | "running";
  runAt: Date;
  attempts: number;
  data: T;
}

/** Adds jobs to one queue, and finds or removes them by key. */
export class JobQueue<T> {
  constructor(
    readonly db: Kysely<Database>,
    readonly name: QueueName,
  ) {}

  /**
   * Adds a job; false when its key is taken by a live job. On a transaction (`on`), the job and
   * the wake that tells the workers both commit with the caller's rows, or neither does.
   */
  async add(
    name: string,
    data: T,
    opts: AddOptions = {},
    on: Kysely<Database> = this.db,
  ): Promise<boolean> {
    const backoff = opts.backoff ?? { type: "fixed", delayMs: 0 };
    const r = await sql<{ queue: string }>`
      WITH added AS (
        INSERT INTO jobs (queue, name, key, data, run_at, max_attempts, backoff, backoff_ms, max_stalls)
        VALUES (${this.name}, ${name}, ${opts.key ?? null}, ${JSON.stringify(data)}::jsonb,
          now() + make_interval(secs => ${opts.delayMs ?? 0}::double precision / 1000),
          ${opts.attempts ?? 1}, ${backoff.type}, ${backoff.delayMs}, ${QUEUES[this.name].maxStalls})
        ON CONFLICT (queue, key) WHERE key IS NOT NULL DO NOTHING
        RETURNING queue)
      SELECT queue, pg_notify('uroboros_jobs', queue) FROM added`.execute(on);
    return r.rows.length > 0;
  }

  /** The live job with `key`, if there is one. */
  async get(key: string): Promise<QueuedJob<T> | undefined> {
    const row = await this.db
      .selectFrom("jobs")
      .select(["state", "run_at", "attempts", "data"])
      .where("queue", "=", this.name)
      .where("key", "=", key)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    return { state: row.state, runAt: row.run_at, attempts: row.attempts, data: row.data as T };
  }

  /** Deletes the waiting (or delayed) job with `key`; false when there is none, or it runs. */
  async removeQueued(key: string): Promise<boolean> {
    const r = await this.db
      .deleteFrom("jobs")
      .where("queue", "=", this.name)
      .where("key", "=", key)
      .where("state", "=", "queued")
      .executeTakeFirst();
    return r.numDeletedRows > 0n;
  }
}
