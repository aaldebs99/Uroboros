import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  Download,
  DownloadRequest,
  NewDownloadBody,
  QueueSelectionBody,
  QueueSelectionResult,
} from "@uroboros/contract";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { requireAdmin } from "../auth/guard.ts";
import { cancelDownload, retryDownload, type DownloadContext } from "./dispatch.ts";
import { createRequest, findRequest, queueSelection, toRequest } from "./requests.ts";
import { downloadRows, toDownloads } from "./serialize.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const idParams = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" } }) });
export const allQuery = z.object({
  all: z
    .enum(["true", "false"])
    .optional()
    .openapi({ param: { name: "all", in: "query" }, description: "Everyone's (admins only)" }),
});

const createRequestRoute = createRoute({
  method: "post",
  path: "/api/downloads",
  tags: ["downloads"],
  summary: "Download a link: a worker probes it; a playlist or channel comes back as a preview",
  request: body(NewDownloadBody),
  responses: {
    202: json(DownloadRequest, "Probing"),
    400: error("Not an http(s) URL, or no such profile"),
  },
});

const getRequestRoute = createRoute({
  method: "get",
  path: "/api/downloads/requests/{id}",
  tags: ["downloads"],
  summary: "A pasted link: probing, its preview, or why it failed",
  request: { params: idParams },
  responses: { 200: json(DownloadRequest, "The request"), 404: error("No such request") },
});

const queueRoute = createRoute({
  method: "post",
  path: "/api/downloads/requests/{id}/queue",
  tags: ["downloads"],
  summary: "Queue the ticked entries of a playlist or channel preview",
  request: { params: idParams, ...body(QueueSelectionBody) },
  responses: {
    200: json(QueueSelectionResult, "Queued"),
    400: error("An entry that is not in the preview"),
    404: error("No such request"),
    409: error("The request has no preview to queue"),
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/api/downloads",
  tags: ["downloads"],
  summary: "The caller's downloads (everyone's with all=true, admins only), active first",
  request: { query: allQuery },
  responses: { 200: json(z.array(Download), "Downloads"), 403: error("all=true needs an admin") },
});

const cancelRoute = createRoute({
  method: "post",
  path: "/api/downloads/{id}/cancel",
  tags: ["downloads"],
  summary: "Cancel a download; a fetch others still wait on keeps going",
  request: { params: idParams },
  responses: {
    204: { description: "Cancelled" },
    404: error("No such download"),
    409: error("Not active"),
  },
});

const retryRoute = createRoute({
  method: "post",
  path: "/api/downloads/{id}/retry",
  tags: ["downloads"],
  summary: "Queue a failed or cancelled download again",
  request: { params: idParams },
  responses: {
    204: { description: "Queued again" },
    404: error("No such download"),
    409: error("Not failed or cancelled, or already being downloaded"),
  },
});

/** Downloads need queues; `gen` and tests without them get 503 `unavailable`. */
export function need(ctx: DownloadContext | undefined): DownloadContext {
  if (ctx === undefined) throw new ApiError("unavailable", "downloads are not available");
  return ctx;
}

export function registerDownloadRoutes(app: OpenAPIHono, ctx: DownloadContext | undefined): void {
  app.openapi(createRequestRoute, async (c) => {
    const req = await createRequest(need(ctx), currentPrincipal(c).userId, c.req.valid("json"));
    return c.json(req, 202);
  });

  app.openapi(getRequestRoute, async (c) => {
    const row = await findRequest(need(ctx).db, currentPrincipal(c), c.req.valid("param").id);
    return c.json(toRequest(row), 200);
  });

  app.openapi(queueRoute, async (c) => {
    const result = await queueSelection(
      need(ctx),
      currentPrincipal(c),
      c.req.valid("param").id,
      c.req.valid("json").entryIds,
    );
    return c.json(result, 200);
  });

  app.openapi(listRoute, async (c) => {
    const d = need(ctx);
    const principal = currentPrincipal(c);
    const all = c.req.valid("query").all === "true";
    if (all) requireAdmin(principal);
    const rows = await downloadRows(d.db, { userId: all ? null : principal.userId });
    return c.json(await toDownloads(d, rows), 200);
  });

  app.openapi(cancelRoute, async (c) => {
    await cancelDownload(need(ctx), currentPrincipal(c), c.req.valid("param").id);
    return c.body(null, 204);
  });

  app.openapi(retryRoute, async (c) => {
    await retryDownload(need(ctx), currentPrincipal(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
}
