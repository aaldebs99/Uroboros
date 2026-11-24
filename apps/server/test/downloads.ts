import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Kysely } from "kysely";
import { pino } from "pino";
import type { Database } from "../src/db/schema.ts";
import { createApp } from "../src/api/app.ts";
import type { DownloadContext } from "../src/downloads/dispatch.ts";
import { createDownloadQueues } from "../src/downloads/queues.ts";
import type { ProfileRow } from "../src/downloads/profiles.ts";
import { asUser, type SignedIn } from "./auth.ts";
import { liveJobs } from "./jobs.ts";

const logger = pino({ level: "silent" });

/** A download context on the test database, plus an app factory (a promise, as it used to be). */
export function downloadHarness(db: Kysely<Database>, limit = 3) {
  const queues = createDownloadQueues(db);
  const ctx: DownloadContext = {
    db,
    queues,
    limits: { maxActivePerUser: limit, maxPlaylistEntries: 1000, minCheckIntervalMinutes: 60 },
    logger,
  };
  const app = (s: SignedIn): OpenAPIHono =>
    asUser(createApp({ db, version: "t", logger, downloads: ctx }, { webDist: null }), s);
  return Promise.resolve({
    ctx,
    queues,
    app,
    /** The keys of the fetch jobs waiting or running. */
    async jobIds(): Promise<string[]> {
      return (await liveJobs(db, "download")).map((j) => j.key ?? "").sort();
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  });
}

/** The built-in default, "Best available". */
export async function seededDefault(db: Kysely<Database>): Promise<ProfileRow> {
  const p = await db
    .selectFrom("format_profiles")
    .selectAll()
    .where("is_default", "=", true)
    .executeTakeFirst();
  if (p === undefined) throw new Error("no default profile");
  return p;
}

export function post(a: OpenAPIHono, path: string, json?: unknown) {
  return a.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
}
