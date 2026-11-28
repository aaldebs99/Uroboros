import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { AdminHealth, ApiErrorBody } from "@uroboros/contract";
import type { Kysely } from "kysely";
import { currentPrincipal } from "../api/principal.ts";
import { requireAdmin } from "../auth/guard.ts";
import type { Database } from "../db/schema.ts";
import { adminHealth, type Self } from "./report.ts";

const healthRoute = createRoute({
  method: "get",
  path: "/api/admin/health",
  tags: ["admin"],
  summary: "The replicas, the version, and the rate limits sites put on the server (admins)",
  responses: {
    200: { description: "Health", content: { "application/json": { schema: AdminHealth } } },
    403: {
      description: "Not an admin",
      content: { "application/json": { schema: ApiErrorBody } },
    },
  },
});

/** Admin › Health (docs/health.md), answered by this replica (`replicaId`, when it checks in). */
export function registerHealthRoutes(
  app: OpenAPIHono,
  deps: { db: Kysely<Database>; version: string; replicaId?: string | undefined },
): void {
  const self: Self = { id: deps.replicaId ?? null, version: deps.version };
  app.openapi(healthRoute, async (c) => {
    const principal = currentPrincipal(c);
    requireAdmin(principal);
    return c.json(await adminHealth(deps.db, self, principal.userId), 200);
  });
}
