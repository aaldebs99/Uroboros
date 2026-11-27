import {
  type AdminHealth,
  type RateLimitEvent,
  type Replica,
  ReplicaCheck,
  type ReplicaStatus,
  type SiteCooldown,
} from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { listRateLimitEvents, type RateLimitEventRow } from "../downloads/rateLimitLog.ts";
import { siteOf } from "../downloads/rateLimits.ts";
import { QUIET_MS } from "./heartbeat.ts";

/**
 * Admin › Health (docs/health.md): the replicas as they checked in, the version of the one
 * answering, every site's cooldown with what waits on it, and the newest rate limits logged.
 */

/** Who answers: this replica's check-in id (null when it has none) and its version. */
export interface Self {
  id: string | null;
  version: string;
}

/** A replica's state: quiet for 45 s, a check failing, or fine. */
function statusOf(quiet: boolean, failing: readonly unknown[]): ReplicaStatus {
  if (quiet) return "not_answering";
  return failing.length > 0 ? "degraded" : "ok";
}

/** The checks this release knows; a newer replica's others go unnamed (it still shows degraded). */
const knownChecks = (failing: readonly string[]) =>
  failing.flatMap((f) => {
    const check = ReplicaCheck.safeParse(f);
    return check.success ? [check.data] : [];
  });

async function listReplicas(db: Kysely<Database>, selfId: string | null): Promise<Replica[]> {
  const rows = await db
    .selectFrom("replicas as r")
    .selectAll("r")
    .select([
      sql<boolean>`r.seen_at < now() - make_interval(secs => ${QUIET_MS / 1000})`.as("quiet"),
      sql<string>`(
        SELECT count(*) FROM jobs j
        WHERE j.state = 'running' AND j.worker = r.host || ':' || r.pid::text
      )`.as("running_jobs"),
    ])
    .orderBy("r.host")
    .orderBy("r.started_at")
    .execute();
  const replicas = rows.map((r) => {
    const failing = knownChecks(r.failing);
    return {
      id: r.id,
      host: r.host,
      version: r.version,
      startedAt: r.started_at.toISOString(),
      seenAt: r.seen_at.toISOString(),
      leader: r.leader,
      status: statusOf(r.quiet, r.failing),
      failing,
      runningJobs: Number(r.running_jobs),
      current: r.id === selfId,
    };
  });
  return [...replicas.filter((r) => r.current), ...replicas.filter((r) => !r.current)];
}

/** How many of each site's downloads and pasted links wait on its cooldown now, by site. */
async function waitingBySite(db: Kysely<Database>) {
  const [downloads, links] = await Promise.all([
    db
      .selectFrom("downloads")
      .select("url")
      .where("state", "=", "queued")
      .where("error_kind", "=", "rate_limited")
      .execute(),
    db
      .selectFrom("download_requests")
      .select("url")
      .where("state", "=", "probing")
      .where("error_kind", "=", "rate_limited")
      .execute(),
  ]);
  const count = (rows: readonly { url: string }[]) => {
    const by = new Map<string, number>();
    for (const r of rows) by.set(siteOf(r.url), (by.get(siteOf(r.url)) ?? 0) + 1);
    return by;
  };
  return { downloads: count(downloads), links: count(links) };
}

async function listCooldowns(db: Kysely<Database>): Promise<SiteCooldown[]> {
  const [rows, waiting] = await Promise.all([
    db
      .selectFrom("site_cooldowns")
      .selectAll()
      .select(sql<boolean>`until > now()`.as("active"))
      .orderBy(sql`until > now()`, "desc")
      .orderBy("site")
      .orderBy("scope")
      .execute(),
    waitingBySite(db),
  ]);
  // Only a site's own cooldown holds downloads and links; a subtitles one holds subtitles alone.
  const held = (by: Map<string, number>, r: (typeof rows)[number]) =>
    r.scope === "site" ? (by.get(r.site) ?? 0) : 0;
  return rows.map((r) => ({
    site: r.site,
    scope: r.scope,
    until: r.until.toISOString(),
    strikes: r.strikes,
    active: r.active,
    waitingDownloads: held(waiting.downloads, r),
    waitingLinks: held(waiting.links, r),
  }));
}

/**
 * The newest limits, each stored video they held linked to the viewer's own entry for it (their
 * newest), when they hold it.
 */
async function listEvents(db: Kysely<Database>, viewerId: string): Promise<RateLimitEvent[]> {
  const rows = await listRateLimitEvents(db);
  const media = [...new Set(rows.flatMap((r) => (r.media_id === null ? [] : [r.media_id])))];
  const entries =
    media.length === 0
      ? []
      : await db
          .selectFrom("library_entries")
          .select(["id", "media_id"])
          .where("user_id", "=", viewerId)
          .where("media_id", "in", media)
          .orderBy("added_at")
          .execute();
  // Oldest first, so the newest of a media's entries is the one kept.
  const entryOf = new Map(entries.map((e) => [e.media_id, e.id]));
  return rows.map((r) =>
    toEvent(r, r.media_id === null ? null : (entryOf.get(r.media_id) ?? null)),
  );
}

const toEvent = (r: RateLimitEventRow, entryId: string | null): RateLimitEvent => ({
  id: r.id,
  at: r.at.toISOString(),
  site: r.site,
  scope: r.scope,
  source: r.source,
  message: r.message,
  url: r.url,
  title: r.title,
  entryId,
  until: r.until.toISOString(),
  hinted: r.hinted,
  strikes: r.strikes,
});

/** The report, as `viewerId` (an admin) sees it: the videos it links are theirs. */
export async function adminHealth(
  db: Kysely<Database>,
  self: Self,
  viewerId: string,
): Promise<AdminHealth> {
  const [replicas, cooldowns, events] = await Promise.all([
    listReplicas(db, self.id),
    listCooldowns(db),
    listEvents(db, viewerId),
  ]);
  return { version: self.version, replicas, cooldowns, events };
}
