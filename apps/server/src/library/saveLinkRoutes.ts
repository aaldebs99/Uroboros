import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorBody, SaveLink } from "@uroboros/contract";
import type { Kysely } from "kysely";
import { currentPrincipal } from "../api/principal.ts";
import type { Database } from "../db/schema.ts";
import { entryFile, needStore } from "../downloads/libraryRoutes.ts";
import { exportFile, finishedExport } from "../exports/routes.ts";
import { visibleEntry } from "../sharing/access.ts";
import type { MediaStore } from "../storage/index.ts";
import { createSaveLink, resolveSaveLink } from "./saveLinks.ts";

/** Save links' routes (docs/downloads.md#saving-a-file): ask for one, then save through it. */

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const binary = (description: string) => ({
  description,
  content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
});
const idParams = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" } }) });
const tokenParams = z.object({
  token: z
    .string()
    .regex(/^[A-Za-z0-9_-]{20,128}$/)
    .openapi({ param: { name: "token", in: "path" } }),
});

const entryLinkRoute = createRoute({
  method: "post",
  path: "/api/library/{id}/save-link",
  tags: ["library"],
  summary:
    "A short-lived link that saves the entry's file (own or shared) without the session cookie",
  request: { params: idParams },
  responses: { 201: json(SaveLink, "The link, for an hour"), 404: error("No such entry") },
});

const exportLinkRoute = createRoute({
  method: "post",
  path: "/api/exports/{id}/save-link",
  tags: ["library"],
  summary: "A short-lived link that saves a finished copy without the session cookie",
  request: { params: idParams },
  responses: {
    201: json(SaveLink, "The link, for an hour"),
    404: error("Not the caller's, or not finished"),
  },
});

const saveRoute = createRoute({
  method: "get",
  path: "/api/public/saves/{token}",
  tags: ["library"],
  summary: "Save through a save link: streamed with range support, or a presigned redirect",
  // The token is the key; whose it is decides access, checked again now.
  security: [],
  request: { params: tokenParams },
  responses: {
    200: binary("The file"),
    206: binary("A byte range of it"),
    302: { description: "A presigned URL (S3 with a public URL set)" },
    404: error("The link doesn't work any more, or the file is no longer the person's to save"),
    416: { description: "The range is past the end" },
  },
});

export function registerSaveLinkRoutes(
  app: OpenAPIHono,
  db: Kysely<Database>,
  store: MediaStore | undefined,
): void {
  app.openapi(entryLinkRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const entry = await visibleEntry(db, { userId }, c.req.valid("param").id);
    return c.json(await createSaveLink(db, userId, { entryId: entry.id }), 201);
  });
  app.openapi(exportLinkRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const copy = await finishedExport(db, userId, c.req.valid("param").id);
    return c.json(await createSaveLink(db, userId, { exportId: copy.id }), 201);
  });
  app.openapi(saveRoute, async (c) => {
    const s = needStore(store);
    const { userId, target } = await resolveSaveLink(db, c.req.valid("param").token);
    return "entryId" in target
      ? entryFile(c, db, s, userId, target.entryId)
      : exportFile(c, db, s, userId, target.exportId);
  });
}
