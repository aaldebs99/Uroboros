import type { ColumnType, Generated } from "kysely";

/**
 * The job queue's tables and the short-lived state replicas share (docs/jobs.md), kept apart from
 * schema.ts for its length.
 */

type Timestamp = ColumnType<Date, Date | string, Date | string>;

/** `jobs`: a job waiting or running (a finished one's row is deleted). */
export interface JobsTable {
  /** BIGINT identity; pg returns it as a string. */
  id: ColumnType<string, never, never>;
  queue: string;
  name: string;
  key: string | null;
  /** Written as a JSON string. */
  data: ColumnType<unknown, string, string>;
  state: Generated<"queued" | "running">;
  run_at: Generated<Date>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  backoff: Generated<"fixed" | "exponential">;
  backoff_ms: Generated<number>;
  stalls: Generated<number>;
  max_stalls: number;
  locked_by: string | null;
  locked_until: Date | null;
  worker: string | null;
  last_error: string | null;
  created_at: Generated<Date>;
}

/** `job_limits`: when a rate-limited queue may start its next job. */
export interface JobLimitsTable {
  queue: string;
  next_start_at: Timestamp;
}

/** `download_progress`: a running fetch's latest progress, kept a minute (unlogged). */
export interface DownloadProgressTable {
  fetch_key: string;
  /** Written as a JSON string. */
  progress: ColumnType<unknown, string, string>;
  expires_at: Timestamp;
}

/** `signin_failures`: failed sign-ins in their window, per username or client IP (unlogged). */
export interface SigninFailuresTable {
  kind: "user" | "ip";
  value: string;
  failures: number;
  expires_at: Timestamp;
}
