import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { AdminStats, ApiErrorBody } from "@uroboros/contract";
import type { Kysely } from "kysely";
import { currentPrincipal } from "../api/principal.ts";
import { requireAdmin } from "../auth/guard.ts";
import type { Database } from "../db/schema.ts";
import { adminStats } from "./stats.ts";

const statsRoute = createRoute({
  method: "get",
  path: "/api/admin/stats",
  tags: ["admin"],
  summary: "What the library holds and what it takes up, per person (admins)",
  responses: {
    200: { description: "Stats", content: { "application/json": { schema: AdminStats } } },
    403: {
      description: "Not an admin",
      content: { "application/json": { schema: ApiErrorBody } },
    },
  },
});

/** Admin › Stats (docs/library.md "Stats"). */
export function registerStatsRoutes(app: OpenAPIHono, db: Kysely<Database>): void {
  app.openapi(statsRoute, async (c) => {
    requireAdmin(currentPrincipal(c));
    return c.json(await adminStats(db), 200);
  });
}
