import { createRoute } from "@hono/zod-openapi";
import { ApiErrorBody, Liveness, Readiness } from "@uroboros/contract";
import type { DependencyName } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Redis } from "ioredis";
import { pingDb } from "../db/kysely.ts";
import type { Database } from "../db/schema.ts";
import { withDeadline } from "../shared/deadline.ts";

export const CHECK_TIMEOUT_MS = 2000;

/** Liveness: answers while the process does, checking nothing (Djinn's `/api/health`). */
export const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  summary: "Liveness: the process is up",
  responses: {
    200: {
      description: "The process answers",
      content: { "application/json": { schema: Liveness } },
    },
  },
});

/** Readiness: 503 until migrations ran and the database is attached, then the dependency report. */
export const readyRoute = createRoute({
  method: "get",
  path: "/api/ready",
  summary: "Readiness and dependency health",
  responses: {
    200: {
      description: "Ready; `degraded` names the failing dependencies but still takes traffic",
      content: { "application/json": { schema: Readiness } },
    },
    503: {
      description: "Still starting: connecting to the database or running migrations",
      content: { "application/json": { schema: Readiness } },
    },
    500: {
      description: "Unexpected error",
      content: { "application/json": { schema: ApiErrorBody } },
    },
  },
});

async function passes(check: () => Promise<unknown>): Promise<boolean> {
  try {
    await withDeadline(check(), CHECK_TIMEOUT_MS, "health check timed out");
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `SELECT 1` and `PING` in parallel, each bounded at 2 s; never throws. The database check
 * bounds its own query too, so a silent server costs a pool client 2 s, not the pool's 30 s.
 */
export async function checkHealth(db: Kysely<Database>, valkey: Redis): Promise<Readiness> {
  const [dbOk, valkeyOk] = await Promise.all([
    passes(() => pingDb(db, CHECK_TIMEOUT_MS)),
    passes(() => valkey.ping()),
  ]);
  const failing: DependencyName[] = [];
  if (!dbOk) failing.push("database");
  if (!valkeyOk) failing.push("valkey");
  return { status: failing.length === 0 ? "ok" : "degraded", failing };
}
