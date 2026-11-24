import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  NewUploadBody,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_TYPES,
  Upload,
  UPLOAD_PART_BYTES,
} from "@uroboros/contract";
import { bodyLimit } from "hono/body-limit";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import {
  completeUpload,
  createUpload,
  describeUpload,
  listUploads,
  ownUpload,
  putUploadPart,
  putUploadThumbnail,
  removeUpload,
  type UploadContext,
} from "./store.ts";

/** Uploads (docs/uploads.md): start one, send its parts and thumbnail, complete or cancel it. */

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const binary = z.string().openapi({ format: "binary" });
/** A raw body: read whole by the handler, which checks its size and bytes itself. */
const raw = (types: readonly string[], description: string) => ({
  body: {
    required: true,
    description,
    content: Object.fromEntries(types.map((t) => [t, { schema: binary }])),
  },
});
const idParams = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" } }) });
const partParams = idParams.extend({
  n: z.coerce
    .number()
    .int()
    .openapi({ param: { name: "n", in: "path" }, description: "From 1" }),
});

function routes(partBytes: number) {
  return {
    create: createRoute({
      method: "post",
      path: "/api/uploads",
      tags: ["uploads"],
      summary: "Start uploading a video: send its parts, then complete it",
      request: {
        body: { required: true, content: { "application/json": { schema: NewUploadBody } } },
      },
      responses: {
        201: json(Upload, "Receiving parts"),
        400: error("A file type uploads don't take, or a blank title"),
        409: error("Five uploads unfinished already"),
        413: error("Over the server's upload size"),
      },
    }),
    list: createRoute({
      method: "get",
      path: "/api/uploads",
      tags: ["uploads"],
      summary: "The caller's unfinished and failed uploads",
      responses: { 200: json(z.array(Upload), "Oldest first") },
    }),
    get: createRoute({
      method: "get",
      path: "/api/uploads/{id}",
      tags: ["uploads"],
      summary: "One of the caller's uploads, with the parts it has",
      request: { params: idParams },
      responses: { 200: json(Upload, "The upload"), 404: error("Not the caller's") },
    }),
    part: createRoute({
      method: "put",
      path: "/api/uploads/{id}/parts/{n}",
      tags: ["uploads"],
      summary: "Send one part: exactly partSize bytes (the last, what is left), in any order",
      middleware: [bodyLimit({ maxSize: partBytes })] as const,
      request: { params: partParams, ...raw(["application/octet-stream"], "The part's bytes") },
      responses: {
        204: { description: "Stored" },
        400: error("Not one of its parts, or not that part's size"),
        404: error("Not the caller's"),
        409: error("It has all its parts"),
        413: error("Bigger than a part"),
      },
    }),
    thumbnail: createRoute({
      method: "put",
      path: "/api/uploads/{id}/thumbnail",
      tags: ["uploads"],
      summary: "Send its thumbnail (JPEG, PNG or WebP); without one a frame of the video is used",
      middleware: [bodyLimit({ maxSize: THUMBNAIL_MAX_BYTES })] as const,
      request: { params: idParams, ...raw(THUMBNAIL_TYPES, "The image") },
      responses: {
        204: { description: "Stored" },
        400: error("Not a JPEG, PNG or WebP image"),
        404: error("Not the caller's"),
        409: error("It has all its parts"),
        413: error("Over 5 MiB"),
      },
    }),
    complete: createRoute({
      method: "post",
      path: "/api/uploads/{id}/complete",
      tags: ["uploads"],
      summary: "Every part is in: the server checks the video and files it in the library",
      request: { params: idParams },
      responses: {
        200: json(Upload, "Processing"),
        404: error("Not the caller's"),
        409: error("A part is missing, or it was completed already"),
      },
    }),
    remove: createRoute({
      method: "delete",
      path: "/api/uploads/{id}",
      tags: ["uploads"],
      summary: "Cancel an upload still receiving parts, or dismiss a failed one",
      request: { params: idParams },
      responses: {
        204: { description: "Gone" },
        404: error("Not the caller's"),
        409: error("It is being processed"),
      },
    }),
  };
}

export function registerUploadRoutes(app: OpenAPIHono, ctx: UploadContext | undefined): void {
  const need = (): UploadContext => {
    if (ctx === undefined) throw new ApiError("unavailable", "uploads are not available");
    return ctx;
  };
  const r = routes(ctx?.partBytes ?? UPLOAD_PART_BYTES);
  const bytesOf = async (req: Request) => new Uint8Array(await req.arrayBuffer());
  app.openapi(r.create, async (c) => {
    const upload = await createUpload(need(), currentPrincipal(c).userId, c.req.valid("json"));
    return c.json(upload, 201);
  });
  app.openapi(r.list, async (c) =>
    c.json(await listUploads(need().db, currentPrincipal(c).userId), 200),
  );
  app.openapi(r.get, async (c) => {
    const { db } = need();
    const row = await ownUpload(db, currentPrincipal(c).userId, c.req.valid("param").id);
    return c.json(await describeUpload(db, row), 200);
  });
  app.openapi(r.part, async (c) => {
    const { id, n } = c.req.valid("param");
    await putUploadPart(need(), currentPrincipal(c).userId, id, n, await bytesOf(c.req.raw));
    return c.body(null, 204);
  });
  app.openapi(r.thumbnail, async (c) => {
    const { id } = c.req.valid("param");
    await putUploadThumbnail(need(), currentPrincipal(c).userId, id, await bytesOf(c.req.raw));
    return c.body(null, 204);
  });
  app.openapi(r.complete, async (c) => {
    const upload = await completeUpload(
      need(),
      currentPrincipal(c).userId,
      c.req.valid("param").id,
    );
    return c.json(upload, 200);
  });
  app.openapi(r.remove, async (c) => {
    await removeUpload(need(), currentPrincipal(c).userId, c.req.valid("param").id);
    return c.body(null, 204);
  });
}
