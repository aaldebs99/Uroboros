/**
 * The job queue's SQL (docs/jobs.md). A run claims its job with one statement that commits at
 * once, so no connection is held while the job runs: the run holds a lease instead (`locked_by`, a
 * random token, until `locked_until`), renewed by its worker. Every outcome is fenced by that
 * token, so a run whose lease lapsed, and whose job went to another, writes nothing. All times are
 * the database's.
 */
import { sql } from "kysely";
import type { Kysely, RawBuilder } from "kysely";
import type { Database } from "../db/schema.ts";
import type { QueueName } from "./queues.ts";

export interface ClaimedJob {
  id: string;
  queue: QueueName;
  name: string;
  key: string | null;
  data: unknown;
  /** Runs started, this one included. */
  attempts: number;
  max_attempts: number;
  /** The run's token. */
  locked_by: string;
}

export interface ClaimOptions {
  limit: number;
  leaseMs: number;
  /** host:pid, for logs. */
  worker: string;
  /** Starts at most one job per this many ms across every replica (then `limit` is 1). */
  startEveryMs?: number;
}

/** A run's hold on its job. */
export interface Held {
  id: string;
  token: string;
}

const ms = (n: number): RawBuilder<unknown> =>
  sql`make_interval(secs => ${n}::double precision / 1000)`;

const CLAIMED = sql`RETURNING j.id, j.queue, j.name, j.key, j.data, j.attempts, j.max_attempts, j.locked_by`;

/** Claims up to `limit` due jobs of `queue`, oldest first, skipping rows other runs are claiming. */
export async function claim(
  db: Kysely<Database>,
  queue: QueueName,
  o: ClaimOptions,
): Promise<ClaimedJob[]> {
  if (o.limit <= 0) return [];
  const limited = o.startEveryMs !== undefined;
  const picked = sql`SELECT id FROM jobs WHERE queue = ${queue} AND state = 'queued' AND run_at <= now()
    ORDER BY run_at, id LIMIT ${limited ? 1 : o.limit} FOR UPDATE SKIP LOCKED`;
  const set = sql`state = 'running', attempts = j.attempts + 1, locked_by = gen_random_uuid(),
    locked_until = now() + ${ms(o.leaseMs)}, worker = ${o.worker}`;
  // The slot row takes the limit across replicas: a run that loses the race re-reads the winner's
  // next_start_at, finds it in the future, and claims nothing.
  const r = limited
    ? await sql<ClaimedJob>`
        WITH picked AS (${picked}),
        slot AS (
          INSERT INTO job_limits AS l (queue, next_start_at)
          SELECT ${queue}, now() + ${ms(o.startEveryMs ?? 0)} FROM picked
          ON CONFLICT (queue) DO UPDATE SET next_start_at = excluded.next_start_at
            WHERE l.next_start_at <= now()
          RETURNING queue)
        UPDATE jobs j SET ${set} FROM picked, slot WHERE j.id = picked.id ${CLAIMED}`.execute(db)
    : await sql<ClaimedJob>`
        WITH picked AS (${picked})
        UPDATE jobs j SET ${set} FROM picked WHERE j.id = picked.id ${CLAIMED}`.execute(db);
  return r.rows;
}

const pairs = (held: readonly Held[]) =>
  sql`unnest(${held.map((h) => h.id)}::bigint[], ${held.map((h) => h.token)}::uuid[]) AS h(id, token)`;

/** Extends the leases still held; returns the ids whose lease was renewed. */
export async function renew(
  db: Kysely<Database>,
  leaseMs: number,
  held: readonly Held[],
): Promise<Set<string>> {
  if (held.length === 0) return new Set();
  const r = await sql<{ id: string }>`
    UPDATE jobs SET locked_until = now() + ${ms(leaseMs)} FROM ${pairs(held)}
    WHERE jobs.id = h.id AND jobs.locked_by = h.token RETURNING jobs.id`.execute(db);
  return new Set(r.rows.map((row) => row.id));
}

/** Deletes a finished (or failed for good) job; false when the run no longer held it. */
export async function finish(db: Kysely<Database>, h: Held): Promise<boolean> {
  const r = await sql`DELETE FROM jobs WHERE id = ${h.id} AND locked_by = ${h.token}::uuid`.execute(
    db,
  );
  return (r.numAffectedRows ?? 0n) > 0n;
}

const backOn = sql`state = 'queued', locked_by = NULL, locked_until = NULL, worker = NULL`;

/** Puts a failed job back for a retry after its backoff; false when the run no longer held it. */
export async function retry(db: Kysely<Database>, h: Held, error: string): Promise<boolean> {
  const r = await sql`
    WITH back AS (
      UPDATE jobs SET ${backOn}, last_error = ${error.slice(0, 2000)},
        run_at = now() + make_interval(secs => (CASE WHEN backoff = 'exponential'
          THEN backoff_ms * power(2, attempts - 1) ELSE backoff_ms END)::double precision / 1000)
      WHERE id = ${h.id} AND locked_by = ${h.token}::uuid RETURNING queue)
    SELECT queue, pg_notify('uroboros_jobs', queue) FROM back`.execute(db);
  return r.rows.length > 0;
}

/** Puts a job back unfinished without spending its attempt; false when the run no longer held it. */
export async function requeue(db: Kysely<Database>, h: Held, delayMs: number): Promise<boolean> {
  const r = await sql`
    WITH back AS (
      UPDATE jobs SET ${backOn}, attempts = attempts - 1, run_at = now() + ${ms(delayMs)}
      WHERE id = ${h.id} AND locked_by = ${h.token}::uuid RETURNING queue)
    SELECT queue, pg_notify('uroboros_jobs', queue) FROM back`.execute(db);
  return r.rows.length > 0;
}

export interface StalledJob {
  outcome: "requeued" | "dropped";
  queue: QueueName;
  name: string;
  key: string | null;
}

/**
 * Puts back running jobs whose run is gone, giving the attempt back and counting a stall; drops
 * those already past their queue's stalls. `held` names the runs to put back (a worker abandoning
 * its own); without it, every run whose lease lapsed.
 */
export async function stallBack(
  db: Kysely<Database>,
  held?: readonly Held[],
): Promise<StalledJob[]> {
  if (held?.length === 0) return [];
  const gone =
    held === undefined
      ? sql`SELECT id FROM jobs WHERE state = 'running' AND locked_until < now() FOR UPDATE SKIP LOCKED`
      : sql`SELECT jobs.id FROM jobs, ${pairs(held)} WHERE jobs.id = h.id AND jobs.locked_by = h.token
          FOR UPDATE OF jobs SKIP LOCKED`;
  const r = await sql<StalledJob>`
    WITH gone AS (${gone}),
    dropped AS (
      DELETE FROM jobs j USING gone WHERE j.id = gone.id AND j.stalls >= j.max_stalls
      RETURNING j.queue, j.name, j.key),
    back AS (
      UPDATE jobs j SET ${backOn}, attempts = j.attempts - 1, stalls = j.stalls + 1, run_at = now()
      FROM gone WHERE j.id = gone.id AND j.stalls < j.max_stalls
      RETURNING j.queue, j.name, j.key)
    SELECT 'dropped' AS outcome, queue, name, key FROM dropped
    UNION ALL
    SELECT 'requeued', queue, name, key FROM back`.execute(db);
  const woken = [...new Set(r.rows.filter((s) => s.outcome === "requeued").map((s) => s.queue))];
  if (woken.length > 0) {
    await sql`SELECT pg_notify('uroboros_jobs', q) FROM unnest(${woken}::text[]) AS q`.execute(db);
  }
  return r.rows;
}

/**
 * How long until `queue` may have work: its earliest waiting job's due time, or for a rate-limited
 * queue its next start slot if that is later. Null when nothing waits; zero or less when a job is
 * due now (claimed by another run, or held back by the limit).
 */
export async function nextWait(db: Kysely<Database>, queue: QueueName): Promise<number | null> {
  const r = await sql<{ due_in: number | null; slot_in: number | null }>`
    SELECT (EXTRACT(EPOCH FROM min(run_at) - now()) * 1000)::float8 AS due_in,
      (SELECT (EXTRACT(EPOCH FROM next_start_at - now()) * 1000)::float8 FROM job_limits
        WHERE queue = ${queue}) AS slot_in
    FROM jobs WHERE queue = ${queue} AND state = 'queued'`.execute(db);
  const row = r.rows[0];
  if (row?.due_in === null || row?.due_in === undefined) return null;
  return Math.max(row.due_in, row.slot_in ?? row.due_in);
}
