import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { MarkNoticesReadBody, NoticeList } from "@uroboros/contract";
import type { Kysely } from "kysely";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import type { Database } from "../db/schema.ts";
import { clearNotices, listNotices, markNoticesRead } from "./store.ts";

/** The caller's notification list (docs/push.md#the-list-in-the-app): read, mark read, clear. */

const listRoute = createRoute({
  method: "get",
  path: "/api/notices",
  tags: ["notifications"],
  summary: "The caller's newest notifications and how many are unread",
  responses: {
    200: { description: "Newest first", content: { "application/json": { schema: NoticeList } } },
  },
});

const readRoute = createRoute({
  method: "post",
  path: "/api/notices/read",
  tags: ["notifications"],
  summary: "Mark read the caller's notifications up to the newest one they saw",
  request: {
    body: { required: true, content: { "application/json": { schema: MarkNoticesReadBody } } },
  },
  responses: { 204: { description: "Marked" } },
});

const clearRoute = createRoute({
  method: "delete",
  path: "/api/notices",
  tags: ["notifications"],
  summary: "Clear the caller's notifications",
  responses: { 204: { description: "Cleared" } },
});

export function registerNoticeRoutes(app: OpenAPIHono, db: Kysely<Database> | undefined): void {
  const need = (): Kysely<Database> => {
    if (db === undefined) throw new ApiError("unavailable", "notifications are not available");
    return db;
  };
  app.openapi(listRoute, async (c) => {
    return c.json(await listNotices(need(), currentPrincipal(c).userId), 200);
  });
  app.openapi(readRoute, async (c) => {
    await markNoticesRead(need(), currentPrincipal(c).userId, c.req.valid("json").upTo);
    return c.body(null, 204);
  });
  app.openapi(clearRoute, async (c) => {
    await clearNotices(need(), currentPrincipal(c).userId);
    return c.body(null, 204);
  });
}
