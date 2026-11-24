import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  ItemDownloadBody,
  LatestBody,
  NewSubscriptionBody,
  QueueSelectionResult,
  Subscription,
  SubscriptionItemsPage,
  SubscriptionPatch,
} from "@uroboros/contract";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { need } from "../downloads/routes.ts";
import { downloadItem } from "./itemDownload.ts";
import { listItems } from "./items.ts";
import { checkNow, queueLatest } from "./queue.ts";
import { listedQuery, ownSubscription } from "./store.ts";
import {
  createSubscription,
  deleteSubscription,
  present,
  updateSubscription,
} from "./subscriptions.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const idParams = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" } }) });
const tags = ["subscriptions"];

const listRoute = createRoute({
  method: "get",
  path: "/api/subscriptions",
  tags,
  summary: "The caller's subscriptions",
  responses: { 200: json(z.array(Subscription), "Subscriptions") },
});

const createSubscriptionRoute = createRoute({
  method: "post",
  path: "/api/subscriptions",
  tags,
  summary: "Subscribe to a previewed channel or playlist; its first check runs at once",
  request: body(NewSubscriptionBody),
  responses: {
    201: json(Subscription, "Subscribed"),
    400: error("An unknown tab or profile, an interval under the minimum, or a bad pattern"),
    404: error("No such request"),
    409: error("Already subscribed, or the request is not a channel or playlist preview"),
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/api/subscriptions/{id}",
  tags,
  summary: "One of the caller's subscriptions",
  request: { params: idParams },
  responses: { 200: json(Subscription, "The subscription"), 404: error("No such subscription") },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/api/subscriptions/{id}",
  tags,
  summary: "Edit, pause or resume a subscription; new filters reconsider what the old held back",
  request: { params: idParams, ...body(SubscriptionPatch) },
  responses: {
    200: json(Subscription, "Edited"),
    400: error("An unknown tab or profile, an interval under the minimum, or a bad pattern"),
    404: error("No such subscription"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/subscriptions/{id}",
  tags,
  summary: "Unsubscribe: its downloads not yet started are cancelled; its videos stay",
  request: { params: idParams },
  responses: { 204: { description: "Unsubscribed" }, 404: error("No such subscription") },
});

const checkRoute = createRoute({
  method: "post",
  path: "/api/subscriptions/{id}/check",
  tags,
  summary: "Check a subscription now",
  request: { params: idParams },
  responses: {
    202: json(Subscription, "A check is queued"),
    404: error("No such subscription"),
    409: error("The subscription is paused"),
  },
});

const latestRoute = createRoute({
  method: "post",
  path: "/api/subscriptions/{id}/latest",
  tags,
  summary: "Download a subscription's latest videos now, whatever its filters say",
  request: { params: idParams, ...body(LatestBody) },
  responses: {
    202: { description: "Queued: a job lists and downloads them" },
    404: error("No such subscription"),
    409: error("The subscription is paused"),
  },
});

const itemDownloadRoute = createRoute({
  method: "post",
  path: "/api/subscriptions/{id}/items/download",
  tags,
  summary: "Download one video the subscription skipped, filtered or is waiting on, now",
  request: { params: idParams, ...body(ItemDownloadBody) },
  responses: {
    200: json(QueueSelectionResult, "Queued, or skipped as already had"),
    404: error("No such subscription, or it never saw that video"),
  },
});

const itemsRoute = createRoute({
  method: "get",
  path: "/api/subscriptions/{id}/items",
  tags,
  summary: "What a subscription has seen and what became of each, newest first",
  request: {
    params: idParams,
    query: z.object({
      cursor: z
        .string()
        .max(512)
        .optional()
        .openapi({ param: { name: "cursor", in: "query" } }),
    }),
  },
  responses: {
    200: json(SubscriptionItemsPage, "A page of items"),
    400: error("Not a cursor this server made"),
    404: error("No such subscription"),
  },
});

export function registerSubscriptionRoutes(
  app: OpenAPIHono,
  ctx: DownloadContext | undefined,
): void {
  app.openapi(listRoute, async (c) => {
    const d = need(ctx);
    const rows = await listedQuery(d.db, currentPrincipal(c).userId)
      .orderBy("s.title")
      .orderBy("s.id")
      .execute();
    return c.json(await Promise.all(rows.map((r) => present(d, r))), 200);
  });

  app.openapi(createSubscriptionRoute, async (c) => {
    const sub = await createSubscription(
      need(ctx),
      currentPrincipal(c).userId,
      c.req.valid("json"),
    );
    return c.json(sub, 201);
  });

  app.openapi(getRoute, async (c) => {
    const d = need(ctx);
    const row = await ownSubscription(d.db, currentPrincipal(c).userId, c.req.valid("param").id);
    return c.json(await present(d, row), 200);
  });

  app.openapi(patchRoute, async (c) => {
    const sub = await updateSubscription(
      need(ctx),
      currentPrincipal(c).userId,
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return c.json(sub, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    await deleteSubscription(need(ctx), currentPrincipal(c).userId, c.req.valid("param").id);
    return c.body(null, 204);
  });

  app.openapi(checkRoute, async (c) => {
    const d = need(ctx);
    const row = await ownSubscription(d.db, currentPrincipal(c).userId, c.req.valid("param").id);
    if (!row.enabled) throw new ApiError("conflict", "this subscription is paused");
    await checkNow(d.queues.automation, row.id);
    return c.json(await present(d, row), 202);
  });

  app.openapi(latestRoute, async (c) => {
    const d = need(ctx);
    const row = await ownSubscription(d.db, currentPrincipal(c).userId, c.req.valid("param").id);
    if (!row.enabled) throw new ApiError("conflict", "this subscription is paused");
    await queueLatest(d.queues.automation, row.id, c.req.valid("json").count);
    return c.body(null, 202);
  });

  app.openapi(itemDownloadRoute, async (c) => {
    const d = need(ctx);
    const id = c.req.valid("param").id;
    return c.json(await downloadItem(d, currentPrincipal(c).userId, id, c.req.valid("json")), 200);
  });

  app.openapi(itemsRoute, async (c) => {
    const d = need(ctx);
    const page = await listItems(
      d.db,
      currentPrincipal(c).userId,
      c.req.valid("param").id,
      c.req.valid("query").cursor,
    );
    return c.json(page, 200);
  });
}
