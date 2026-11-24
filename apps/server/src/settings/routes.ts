import { createRoute, type OpenAPIHono, type z } from "@hono/zod-openapi";
import { ApiErrorBody, InstanceSettings, InstanceSettingsPatch } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { currentPrincipal } from "../api/principal.ts";
import { requireAdmin } from "../auth/guard.ts";
import { readInstanceSettings, writeInstanceSettings } from "./store.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);

const getRoute = createRoute({
  method: "get",
  path: "/api/admin/settings",
  tags: ["admin"],
  summary: "The instance's settings (the MCP server's switch)",
  responses: { 200: json(InstanceSettings, "Settings"), 403: error("Admins only") },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/api/admin/settings",
  tags: ["admin"],
  summary: "Change the instance's settings; takes effect on every replica at once",
  request: {
    body: { required: true, content: { "application/json": { schema: InstanceSettingsPatch } } },
  },
  responses: {
    200: json(InstanceSettings, "The settings after the change"),
    400: error("Nothing to change"),
    403: error("Admins only"),
  },
});

export function registerSettingsRoutes(app: OpenAPIHono, db: Kysely<Database>): void {
  app.openapi(getRoute, async (c) => {
    requireAdmin(currentPrincipal(c));
    return c.json(await readInstanceSettings(db), 200);
  });

  app.openapi(patchRoute, async (c) => {
    const principal = currentPrincipal(c);
    requireAdmin(principal);
    return c.json(await writeInstanceSettings(db, c.req.valid("json"), principal.userId), 200);
  });
}
