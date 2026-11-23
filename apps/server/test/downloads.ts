import { randomUUID } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Redis } from "ioredis";
import type { Kysely } from "kysely";
import { pino } from "pino";
import type { Database } from "../src/db/schema.ts";
import { createApp } from "../src/api/app.ts";
import type { DownloadContext } from "../src/downloads/dispatch.ts";
import { createDownloadQueues } from "../src/downloads/queues.ts";
import { defaultProfile, type ProfileRow } from "../src/downloads/profiles.ts";
import { createValkey, waitReady } from "../src/shared/valkey.ts";
import { asUser, type SignedIn } from "./auth.ts";
import { TestValkey } from "./testValkey.ts";

const logger = pino({ level: "silent" });

/** A download context on the shared test Valkey under a fresh prefix, plus an app factory. */
export async function downloadHarness(db: Kysely<Database>, limit = 3) {
  const prefix = `t-${randomUUID()}`;
  const valkey: Redis = createValkey(TestValkey.url(), "api", logger);
  await waitReady(valkey, 5000);
  const queues = createDownloadQueues(valkey, prefix);
  const ctx: DownloadContext = {
    db,
    valkey,
    prefix,
    queues,
    limits: { maxActivePerUser: limit, maxPlaylistEntries: 1000, minCheckIntervalMinutes: 60 },
    logger,
  };
  const app = (s: SignedIn): OpenAPIHono =>
    asUser(createApp({ db, valkey, version: "t", logger, downloads: ctx }, { webDist: null }), s);
  return {
    ctx,
    prefix,
    queues,
    app,
    async jobIds(): Promise<string[]> {
      const jobs = await queues.download.getJobs(["waiting", "active", "delayed", "prioritized"]);
      return jobs.map((j) => j.id ?? "").sort();
    },
    async close(): Promise<void> {
      await queues.close();
      valkey.disconnect();
      await TestValkey.clear(prefix);
    },
  };
}

export async function seededDefault(db: Kysely<Database>): Promise<ProfileRow> {
  const p = await defaultProfile(db);
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
