import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorBody, ClipItem } from "@uroboros/contract";
import type { Context } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { needStore } from "../downloads/libraryRoutes.ts";
import { visibleClip } from "../sharing/clipAccess.ts";
import { clipFile, clipThumbnail } from "../sharing/clipPublic.ts";
import { clipItem } from "../sharing/clipView.ts";
import type { MediaStore } from "../storage/index.ts";

/**
 * A clip shared on its own (docs/sharing.md#clips), for its owner and the people a live share of it
 * reaches: the clip, its file to play and save, and its thumbnail. The video it was cut from stays
 * out of reach. All of it is 404 while clips are off.
 */

const id = z.uuid().openapi({ param: { name: "id", in: "path" } });
const params = z.object({ id });
const missing = {
  description: "No such clip, not shared with the caller, or clips are off",
  content: { "application/json": { schema: ApiErrorBody } },
};
const binary = (description: string) => ({
  description,
  content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
});
const fileResponses = {
  200: binary("The clip"),
  206: binary("A byte range of it"),
  302: { description: "A presigned URL" },
  404: missing,
  416: { description: "The range is past the end" },
};
const tags = ["clips"];

const clipRoute = createRoute({
  method: "get",
  path: "/api/clips/{id}",
  tags,
  summary: "A clip the caller made or that is shared with them, with what its player needs",
  request: { params },
  responses: {
    200: { description: "The clip", content: { "application/json": { schema: ClipItem } } },
    404: missing,
  },
});
const streamRoute = createRoute({
  method: "get",
  path: "/api/clips/{id}/stream",
  tags,
  summary: "A clip's file inline, for the player",
  request: { params },
  responses: fileResponses,
});
const fileRoute = createRoute({
  method: "get",
  path: "/api/clips/{id}/file",
  tags,
  summary: "Save a clip's file",
  request: { params },
  responses: fileResponses,
});
const thumbnailRoute = createRoute({
  method: "get",
  path: "/api/clips/{id}/thumbnail",
  tags,
  summary: "A clip's thumbnail: its video's",
  request: { params },
  responses: { 200: binary("The image"), 404: missing },
});

export function registerClipRoutes(
  app: OpenAPIHono,
  db: Kysely<Database>,
  store: MediaStore | undefined,
  clips: boolean,
): void {
  const seen = (c: Context, exportId: string) => {
    if (!clips) throw new ApiError("not_found", "clips are off on this server");
    return visibleClip(db, { userId: currentPrincipal(c).userId }, exportId);
  };
  app.openapi(clipRoute, async (c) => {
    const exportId = c.req.valid("param").id;
    return c.json(clipItem(await seen(c, exportId), `/api/clips/${exportId}`), 200);
  });
  app.openapi(streamRoute, async (c) =>
    clipFile(c, needStore(store), await seen(c, c.req.valid("param").id), false),
  );
  app.openapi(fileRoute, async (c) =>
    clipFile(c, needStore(store), await seen(c, c.req.valid("param").id), true),
  );
  app.openapi(thumbnailRoute, async (c) =>
    clipThumbnail(c, needStore(store), await seen(c, c.req.valid("param").id)),
  );
}
