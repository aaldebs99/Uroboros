import { createRoute, type OpenAPIHono, type z } from "@hono/zod-openapi";
import { ApiErrorBody } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { runSyncPass } from "./claimsSync.ts";
import { requireAdmin } from "./guard.ts";
import type { OidcProvider } from "./oidc/provider.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);

const syncRoute = createRoute({
  method: "post",
  path: "/api/admin/users/oidc-sync",
  tags: ["admin"],
  summary: "Refresh every SSO user's groups and role from the provider now",
  responses: {
    204: { description: "Pass finished (or OIDC is not set up)" },
    403: error("Admins only"),
    409: error("A pass is already running"),
  },
});

export interface AdminUserRoutesContext {
  db: Kysely<Database>;
  provider: OidcProvider;
  databaseUrl: string;
  logger: Logger;
}

export function registerAdminUserRoutes(app: OpenAPIHono, ctx: AdminUserRoutesContext): void {
  app.openapi(syncRoute, async (c) => {
    requireAdmin(currentPrincipal(c));
    const outcome = await runSyncPass(ctx);
    if (outcome === "busy") throw new ApiError("conflict", "a sync pass is already running");
    return c.body(null, 204);
  });
}
