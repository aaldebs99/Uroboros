import { DownloadProgress } from "@uroboros/contract";
import { sql } from "kysely";
import type { Kysely } from "kysely";
import { notify, notifyAll } from "../db/notifications.ts";
import type { Database } from "../db/schema.ts";

/**
 * What replicas tell each other on the `uroboros_downloads` channel: downloads' changes, that a
 * person's notification list changed (docs/push.md#the-list-in-the-app), or their pasted links
 * waiting for a pick did (docs/downloads.md), that some people's
 * hover previews being made changed (docs/library.md "Hover previews"), and how a person's
 * SponsorBlock refetch went (`found` segments to skip, or the `error`; docs/automation.md).
 */
export type InternalEvent =
  | { kind: "state"; downloadId: string; userId: string }
  | { kind: "progress"; fetchKey: string; progress: DownloadProgress }
  | { kind: "notice"; userId: string }
  | { kind: "previews"; userIds: string[] }
  | { kind: "requests"; userId: string }
  | {
      kind: "skips";
      userId: string;
      entryId: string;
      found: number | null;
      error: string | null;
      /** SponsorBlock's segments in any category; absent from a replica of the release before. */
      total?: number | null;
      /** Whether the file has a highlight now; absent from a replica of the release before. */
      highlight?: boolean;
    };

/** How long the latest progress of a fetch is kept for page loads. */
export const PROGRESS_TTL_S = 60;

export async function publishDownloadEvent(
  db: Kysely<Database>,
  event: InternalEvent,
): Promise<void> {
  await notify(db, "uroboros_downloads", JSON.stringify(event));
}

/** Several events in one statement (a fetch settling for everyone who waited on it). */
export async function publishDownloadEvents(
  db: Kysely<Database>,
  events: readonly InternalEvent[],
): Promise<void> {
  await notifyAll(
    db,
    "uroboros_downloads",
    events.map((e) => JSON.stringify(e)),
  );
}

/** Asks whichever replica runs the fetch with `key` to abort it. */
export async function publishCancel(db: Kysely<Database>, key: string): Promise<void> {
  await notify(db, "uroboros_cancel", JSON.stringify({ fetchKey: key }));
}

/** Keeps a fetch's latest progress for a minute and tells every replica, in one statement. */
export async function saveProgress(
  db: Kysely<Database>,
  key: string,
  progress: DownloadProgress,
): Promise<void> {
  const event: InternalEvent = { kind: "progress", fetchKey: key, progress };
  await sql`
    WITH saved AS (
      INSERT INTO download_progress (fetch_key, progress, expires_at)
      VALUES (${key}, ${JSON.stringify(progress)}::jsonb, now() + make_interval(secs => ${PROGRESS_TTL_S}))
      ON CONFLICT (fetch_key) DO UPDATE SET progress = excluded.progress, expires_at = excluded.expires_at
      RETURNING fetch_key)
    SELECT set_config('synchronous_commit', 'off', true), pg_notify('uroboros_downloads', ${JSON.stringify(event)})
    FROM saved`.execute(db);
}

/** The latest progress of each fetch key that has one. */
export async function latestProgress(
  db: Kysely<Database>,
  keys: readonly string[],
): Promise<Map<string, DownloadProgress>> {
  const out = new Map<string, DownloadProgress>();
  if (keys.length === 0) return out;
  const rows = await db
    .selectFrom("download_progress")
    .select(["fetch_key", "progress"])
    .where("fetch_key", "in", keys)
    .where("expires_at", ">", sql<Date>`now()`)
    .execute();
  for (const row of rows) {
    const parsed = DownloadProgress.safeParse(row.progress);
    if (parsed.success) out.set(row.fetch_key, parsed.data);
  }
  return out;
}

/** Deletes expired progress (readers skip it anyway); a leader duty. Returns how many rows. */
export async function sweepExpiredProgress(db: Kysely<Database>): Promise<number> {
  const r = await db
    .deleteFrom("download_progress")
    .where("expires_at", "<=", sql<Date>`now()`)
    .executeTakeFirst();
  return Number(r.numDeletedRows);
}
