import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { PreviewWork } from "@uroboros/contract";
import type { Kysely } from "kysely";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import type { Database } from "../db/schema.ts";
import { previewWork } from "./work.ts";

const workRoute = createRoute({
  method: "get",
  path: "/api/previews",
  tags: ["library"],
  summary: "The caller's hover previews being made",
  description:
    "Over the videos in the caller's library: how many wait for a preview, and the one being made (docs/library.md).",
  responses: {
    200: {
      description: "Their previews' work",
      content: { "application/json": { schema: PreviewWork } },
    },
  },
});

/**
 * The bell's view of hover previews (docs/push.md#the-list-in-the-app); `generating` is whether
 * previews are on (`UROBOROS_GENERATE_PREVIEWS`), on unless said.
 */
export function registerPreviewRoutes(
  app: OpenAPIHono,
  db: Kysely<Database> | undefined,
  generating = true,
): void {
  app.openapi(workRoute, async (c) => {
    if (db === undefined) throw new ApiError("unavailable", "previews are not available");
    return c.json(await previewWork(db, currentPrincipal(c).userId, generating), 200);
  });
}
