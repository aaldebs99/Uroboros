import type { DownloadErrorKind } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { SubscriptionRow } from "./store.ts";

/** How long a check may hold its subscription before another may take it (renewed as it goes). */
export const LEASE_MINUTES = 15;

const until = sql<Date>`now() + make_interval(mins => ${LEASE_MINUTES})`;

/**
 * Takes the subscription for one check: enabled, no other check holding it, and its owner neither
 * disabled nor revoked. Undefined when any of that fails (the caller just returns).
 */
export async function takeLease(
  db: Kysely<Database>,
  id: string,
): Promise<SubscriptionRow | undefined> {
  return db
    .updateTable("subscriptions as s")
    .set({ lease_until: until })
    .where("s.id", "=", id)
    .where("s.enabled", "=", true)
    .where((eb) =>
      eb.or([eb("s.lease_until", "is", null), eb("s.lease_until", "<", sql<Date>`now()`)]),
    )
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("users as u")
          .select("u.id")
          .whereRef("u.id", "=", "s.user_id")
          .where("u.disabled_at", "is", null)
          .where("u.revoked_at", "is", null),
      ),
    )
    .returningAll()
    .executeTakeFirst();
}

/** Pushes the lease out again; a long check calls it between feeds and probes. */
export async function renewLease(db: Kysely<Database>, id: string): Promise<void> {
  await db.updateTable("subscriptions").set({ lease_until: until }).where("id", "=", id).execute();
}

/** Lets the lease go without recording anything (a check cut by shutdown). */
export async function freeLease(db: Kysely<Database>, id: string): Promise<void> {
  await db.updateTable("subscriptions").set({ lease_until: null }).where("id", "=", id).execute();
}

export type CheckOutcome =
  /** `primedUrls`: the feeds this check primed (a feed edited in meanwhile keeps its edit). */
  | { ok: true; primedUrls: string[]; warning: string | null }
  | { ok: false; kind: DownloadErrorKind; message: string };

/**
 * Sets `primedAt` on the row's own feeds whose URL the check primed and that are still unprimed,
 * leaving every other feed as the row has it now: an edit made while the check ran survives.
 */
function primeFeeds(urls: string[]) {
  const now = new Date().toISOString();
  return sql<string>`(
    SELECT coalesce(jsonb_agg(
      CASE WHEN f->>'url' = ANY(${urls}::text[]) AND coalesce(f->>'primedAt', '') = ''
        THEN f || jsonb_build_object('primedAt', ${now}::text) ELSE f END
      ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(subscriptions.feeds) WITH ORDINALITY AS x(f, ord))`;
}

/** Ends the check: records how it went and frees the lease. Returns the failures in a row. */
export async function releaseLease(
  db: Kysely<Database>,
  id: string,
  outcome: CheckOutcome,
): Promise<{ failures: number }> {
  const row = await db
    .updateTable("subscriptions")
    .set(
      outcome.ok
        ? {
            lease_until: null,
            last_checked_at: new Date(),
            last_error_kind: null,
            last_error_message: null,
            failures: 0,
            feeds: primeFeeds(outcome.primedUrls),
            warning: outcome.warning,
          }
        : {
            lease_until: null,
            last_checked_at: new Date(),
            last_error_kind: outcome.kind,
            last_error_message: outcome.message,
            failures: sql<number>`failures + 1`,
          },
    )
    .where("id", "=", id)
    .returning("failures")
    .executeTakeFirst();
  return { failures: row?.failures ?? 0 };
}
