import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/** The window failed sign-ins are counted in. */
export const FAILURE_WINDOW_SECONDS = 15 * 60;
/**
 * The limits, per kind of key. A username is locked after 5 failures from one address, so a
 * stranger's guesses lock only the stranger's address, never the person signing in from their
 * own; 100 across every address bound a guesser spread over many, and 30 per address bound one
 * guessing many usernames.
 */
export const MAX_FAILURES: Readonly<Record<FailureKey["kind"], number>> = {
  user_ip: 5,
  user: 100,
  ip: 30,
};

export interface FailureKey {
  /** `user_ip`: a username from one client IP, value `name|ip`; `user`: a username; `ip`. */
  kind: "user_ip" | "user" | "ip";
  value: string;
}

const ORDER: Readonly<Record<FailureKey["kind"], number>> = { user_ip: 0, user: 1, ip: 2 };

/** The keys one sign-in attempt counts against. */
export function failureKeys(username: string, ip: string): FailureKey[] {
  return [
    { kind: "user_ip", value: `${username}|${ip}` },
    { kind: "user", value: username },
    { kind: "ip", value: ip },
  ];
}

/** Each key once, in one fixed order: every upsert then locks its rows in the same order. */
function distinct(keys: readonly FailureKey[]): FailureKey[] {
  const seen = new Map(keys.map((k) => [`${k.kind}\u0000${k.value}`, k]));
  return [...seen.values()].sort((a, b) =>
    a.kind === b.kind ? (a.value < b.value ? -1 : 1) : ORDER[a.kind] - ORDER[b.kind],
  );
}

/**
 * Sign-in attempt counters in Postgres (`signin_failures`), so every replica shares them (Djinn's
 * are per process). `attempt` counts first and checks after, in one statement, so a burst of
 * parallel guesses cannot all pass the check before any of them is counted; `succeeded` takes a
 * good sign-in back off the counters. A window starts at a key's first failure and lasts 15
 * minutes.
 */
export function createLimiter(db: Kysely<Database>) {
  return {
    /** Counts one attempt against every key; true when any key is now over its limit. */
    async attempt(keys: FailureKey[]): Promise<boolean> {
      const ks = distinct(keys);
      if (ks.length === 0) return false;
      const r = await sql<{ kind: FailureKey["kind"]; failures: number }>`
        INSERT INTO signin_failures AS f (kind, value, failures, expires_at)
        SELECT k, v, 1, now() + make_interval(secs => ${FAILURE_WINDOW_SECONDS})
        FROM unnest(${ks.map((k) => k.kind)}::text[], ${ks.map((k) => k.value)}::text[]) AS t(k, v)
        ON CONFLICT (kind, value) DO UPDATE SET
          failures = CASE WHEN f.expires_at <= now() THEN 1 ELSE f.failures + 1 END,
          expires_at = CASE WHEN f.expires_at <= now() THEN excluded.expires_at ELSE f.expires_at END
        RETURNING kind, failures`.execute(db);
      return r.rows.some((row) => row.failures > MAX_FAILURES[row.kind]);
    },
    /** A good sign-in: clears the username's counts and takes this attempt off the IP's. */
    async succeeded(keys: FailureKey[]): Promise<void> {
      const values = (kind: FailureKey["kind"]) =>
        distinct(keys)
          .filter((k) => k.kind === kind)
          .map((k) => k.value);
      await sql`
        WITH cleared AS (
          DELETE FROM signin_failures
          WHERE (kind = 'user_ip' AND value = ANY(${values("user_ip")}::text[]))
            OR (kind = 'user' AND value = ANY(${values("user")}::text[])))
        UPDATE signin_failures SET failures = greatest(failures - 1, 0)
        WHERE kind = 'ip' AND value = ANY(${values("ip")}::text[]) AND expires_at > now()`.execute(
        db,
      );
    },
  };
}

export type Limiter = ReturnType<typeof createLimiter>;

/** Deletes windows that ended (the limiter restarts them anyway); a leader duty. */
export async function sweepExpiredFailures(db: Kysely<Database>): Promise<number> {
  const r = await db
    .deleteFrom("signin_failures")
    .where("expires_at", "<=", sql<Date>`now()`)
    .executeTakeFirst();
  return Number(r.numDeletedRows);
}
