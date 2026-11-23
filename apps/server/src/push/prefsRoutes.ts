import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { NotificationPrefs } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { currentPrincipal } from "../api/principal.ts";
import { getPrefs, setPrefs } from "./prefs.ts";

const prefs = {
  description: "The choices",
  content: { "application/json": { schema: NotificationPrefs } },
};

const getRoute = createRoute({
  method: "get",
  path: "/api/me/notifications",
  tags: ["push"],
  summary: "Which kinds of notification the caller gets (all by default)",
  responses: { 200: prefs },
});

const putRoute = createRoute({
  method: "put",
  path: "/api/me/notifications",
  tags: ["push"],
  summary: "Choose which kinds of notification the caller gets",
  request: {
    body: { required: true, content: { "application/json": { schema: NotificationPrefs } } },
  },
  responses: { 200: prefs },
});

/** The caller's notification choices (docs/push.md). */
export function registerNotificationPrefRoutes(app: OpenAPIHono, db: Kysely<Database>): void {
  app.openapi(getRoute, async (c) => c.json(await getPrefs(db, currentPrincipal(c).userId), 200));
  app.openapi(putRoute, async (c) =>
    c.json(await setPrefs(db, currentPrincipal(c).userId, c.req.valid("json")), 200),
  );
}
