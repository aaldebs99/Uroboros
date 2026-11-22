import { createRoute } from "@hono/zod-openapi";
import { ApiErrorBody, Health } from "@uroboros/contract";
import type { DependencyName } from "@uroboros/contract";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Redis } from "ioredis";
import type { Database } from "../db/schema.ts";

export const CHECK_TIMEOUT_MS = 2000;

export const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  summary: "Liveness and dependency health",
  responses: {
    200: {
      description: "Health, possibly degraded",
      content: { "application/json": { schema: Health } },
    },
    500: {
      description: "Unexpected error",
      content: { "application/json": { schema: ApiErrorBody } },
    },
  },
});

async function withTimeout(check: () => Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("health check timed out"));
    }, ms);
  });
  try {
    await Promise.race([check(), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `SELECT 1` and `PING` in parallel, each bounded by a timeout; never throws. */
export async function checkHealth(db: Kysely<Database>, valkey: Redis): Promise<Health> {
  const [dbOk, valkeyOk] = await Promise.all([
    withTimeout(() => sql`SELECT 1`.execute(db), CHECK_TIMEOUT_MS),
    withTimeout(() => valkey.ping(), CHECK_TIMEOUT_MS),
  ]);
  const failing: DependencyName[] = [];
  if (!dbOk) failing.push("database");
  if (!valkeyOk) failing.push("valkey");
  return { status: failing.length === 0 ? "ok" : "degraded", failing };
}
