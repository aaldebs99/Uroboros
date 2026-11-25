import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorBody, Export } from "@uroboros/contract";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { serve } from "../downloads/libraryRoutes.ts";
import { contentTypeOf } from "../storage/contentType.ts";
import { sanitizeSegment, type MediaStore } from "../storage/index.ts";
import { createExport, listExports, ownExport, removeExport } from "./store.ts";

/** Copies to save without SponsorBlock segments (docs/transcoding.md): ask, list, save, remove. */

export interface ExportContext extends DownloadContext {
  store: MediaStore;
}

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const idParams = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" } }) });

const createRouteDef = createRoute({
  method: "post",
  path: "/api/library/{id}/export",
  tags: ["library"],
  summary: "Ask for a copy of an entry without its SponsorBlock segments, re-encoded to save",
  request: { params: idParams },
  responses: {
    200: json(Export, "The same copy, already asked for"),
    201: json(Export, "Queued"),
    400: error("The video has no segments to cut"),
    404: error("No such entry"),
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/api/exports",
  tags: ["library"],
  summary: "The caller's copies to save, newest first (kept until removed)",
  responses: { 200: json(z.array(Export), "Newest first") },
});

const fileRoute = createRoute({
  method: "get",
  path: "/api/exports/{id}/file",
  tags: ["library"],
  summary: "Save a finished copy: streamed with range support, or a presigned redirect",
  request: { params: idParams },
  responses: {
    200: {
      description: "The copy: an MP4 of a video, or an audio file in its own container",
      content: {
        "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) },
      },
    },
    206: { description: "A byte range of it" },
    302: { description: "A presigned URL (S3 with a public URL set)" },
    404: error("Not the caller's, or not finished"),
    416: { description: "The range is past the end" },
  },
});

const removeRoute = createRoute({
  method: "delete",
  path: "/api/exports/{id}",
  tags: ["library"],
  summary: "Remove a copy (stopping it if it is being made)",
  request: { params: idParams },
  responses: { 204: { description: "Removed" }, 404: error("Not the caller's") },
});

export function registerExportRoutes(app: OpenAPIHono, ctx: ExportContext | undefined): void {
  const need = (): ExportContext => {
    if (ctx === undefined) throw new ApiError("unavailable", "copies are not available");
    return ctx;
  };
  app.openapi(createRouteDef, async (c) => {
    const made = await createExport(need(), currentPrincipal(c).userId, c.req.valid("param").id);
    return c.json(made.export, made.created ? 201 : 200);
  });
  app.openapi(listRoute, async (c) =>
    c.json(await listExports(need().db, currentPrincipal(c).userId), 200),
  );
  app.openapi(fileRoute, async (c) => {
    const { db, store } = need();
    const row = await ownExport(db, currentPrincipal(c).userId, c.req.valid("param").id);
    if (row.state !== "done" || row.storage_key === null) {
      throw new ApiError("not_found", "the copy is not ready");
    }
    const filename = `${sanitizeSegment(row.title ?? row.video_id)} (no sponsors).${row.format}`;
    const url = await store.downloadUrl(row.storage_key, filename);
    if (url !== null) return c.redirect(url, 302);
    return serve(c, store, row.storage_key, contentTypeOf(row.format), filename);
  });
  app.openapi(removeRoute, async (c) => {
    await removeExport(need().db, currentPrincipal(c).userId, c.req.valid("param").id);
    return c.body(null, 204);
  });
}
