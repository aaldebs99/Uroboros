/**
 * `/api/me/push`: whether this server pushes, the caller's devices, and turning a device on, off
 * or testing it (docs/push.md). The routes exist whether push is on or not, so the UI can say so.
 */
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  PUSH_LABEL_CHARS,
  PushDevice,
  PushDeviceId,
  PushEndpointStatus,
  PushSubscriptionBody,
  PushTestResult,
  PushView,
  type PushTestOutcome,
} from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { lockKey } from "../shared/lockKeys.ts";
import {
  deleteDevice,
  endpointHash,
  endpointStatus,
  findDevice,
  listDevices,
  upsertDevice,
  type DeviceRow,
} from "../push/devices.ts";
import { checkSubscription, SubscriptionError } from "../push/endpoint.ts";
import type { Pusher } from "../push/pusher.ts";
import type { PushOutcome } from "../push/sender.ts";
import type { PushService } from "../push/service.ts";
import { ApiError } from "./errors.ts";
import { currentPrincipal } from "./principal.ts";

/** What a device is called when the browser gave no label. */
const DEFAULT_LABEL = "This device";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const idParams = z.object({
  id: PushDeviceId.openapi({ param: { name: "id", in: "path" }, description: "Device id" }),
});

const viewRoute = createRoute({
  method: "get",
  path: "/api/me/push",
  tags: ["push"],
  summary: "Whether this server pushes, its VAPID key, and the caller's devices",
  responses: {
    200: json(PushView, "Push and the caller's devices"),
    500: error("Unexpected error"),
  },
});

const registerRoute = createRoute({
  method: "post",
  path: "/api/me/push/devices",
  tags: ["push"],
  summary: "Turn notifications on for the browser whose subscription this is",
  request: {
    body: { required: true, content: { "application/json": { schema: PushSubscriptionBody } } },
  },
  responses: {
    200: json(PushDevice, "The device"),
    400: error("Not a subscription on an allowed push service"),
    409: error("Push is off on this server"),
    422: error("The caller has as many devices as allowed"),
    500: error("Unexpected error"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/me/push/devices/{id}",
  tags: ["push"],
  summary: "Turn notifications off for one of the caller's devices",
  request: { params: idParams },
  responses: {
    204: { description: "Removed" },
    400: error("Not a device id"),
    404: error("No such device of the caller's"),
    500: error("Unexpected error"),
  },
});

const statusRoute = createRoute({
  method: "get",
  path: "/api/me/push/devices/status",
  tags: ["push"],
  summary:
    "Whether this browser's endpoint is one of the caller's devices, or was turned off elsewhere",
  request: { query: z.object({ endpoint: z.string().min(1).max(2048) }) },
  responses: { 200: json(PushEndpointStatus, "The endpoint's status") },
});

const testRoute = createRoute({
  method: "post",
  path: "/api/me/push/devices/{id}/test",
  tags: ["push"],
  summary: "Send one of the caller's devices a test notification",
  request: { params: idParams },
  responses: {
    200: json(PushTestResult, "How it went"),
    400: error("Not a device id"),
    404: error("No such device of the caller's"),
    409: error("Push is off on this server"),
    500: error("Unexpected error"),
  },
});

function view(row: DeviceRow): PushDevice {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at.toISOString(),
    lastSuccessAt: row.last_success_at?.toISOString() ?? null,
    failedAt: row.failed_at?.toISOString() ?? null,
  };
}

function testOutcome(outcome: PushOutcome): PushTestOutcome {
  switch (outcome.kind) {
    case "delivered":
      return "delivered";
    case "gone":
      return "gone";
    case "rejected":
    case "failed":
      return "failed";
  }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The label trimmed and cut to `PUSH_LABEL_CHARS` characters as a person counts them. */
function labelOf(raw: string): string {
  const parts = Array.from(graphemes.segment(raw.trim()), (part) => part.segment);
  const label = parts.slice(0, PUSH_LABEL_CHARS).join("").trim();
  return label === "" ? DEFAULT_LABEL : label;
}

async function requirePusher(push: PushService): Promise<Pusher> {
  const pusher = await push.pusher();
  if (pusher === null) throw new ApiError("conflict", "push notifications are off on this server");
  return pusher;
}

async function register(
  db: Kysely<Database>,
  push: PushService,
  userId: string,
  body: PushSubscriptionBody,
): Promise<PushDevice> {
  const pusher = await requirePusher(push);
  let subscription;
  try {
    subscription = checkSubscription(body, pusher.allowedHosts);
  } catch (err) {
    if (err instanceof SubscriptionError) throw new ApiError("bad_request", err.message);
    throw err;
  }
  const row = await db.transaction().execute(async (tx) => {
    // One registration per user at a time, across replicas: the cap check and the insert agree.
    await sql`SELECT pg_advisory_xact_lock(${lockKey("PUSH", userId).toString()}::bigint)`.execute(
      tx,
    );
    const owner = await tx
      .selectFrom("push_devices")
      .select("user_id")
      .where("endpoint", "=", subscription.endpoint)
      .executeTakeFirst();
    if (owner !== undefined && owner.user_id !== userId) {
      throw new ApiError("conflict", "this browser's notifications belong to another account");
    }
    if (owner === undefined) {
      const devices = await listDevices(tx, userId);
      if (devices.length >= push.maxDevices) {
        throw new ApiError(
          "unprocessable",
          `notifications are on for ${String(devices.length)} devices already; turn one off first`,
        );
      }
    }
    await tx
      .deleteFrom("push_device_tombstones")
      .where("endpoint_hash", "=", endpointHash(subscription.endpoint))
      .execute();
    return upsertDevice(tx, { userId, ...subscription, label: labelOf(body.label) });
  });
  return view(row);
}

export function registerPushRoutes(
  app: OpenAPIHono,
  db: Kysely<Database>,
  push: PushService,
): void {
  app.openapi(viewRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const [pusher, devices] = await Promise.all([push.pusher(), listDevices(db, userId)]);
    return c.json(
      {
        enabled: pusher !== null,
        publicKey: pusher?.publicKey ?? null,
        devices: devices.map(view),
        maxDevices: push.maxDevices,
      },
      200,
    );
  });

  app.openapi(statusRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    return c.json(await endpointStatus(db, userId, c.req.valid("query").endpoint), 200);
  });

  app.openapi(registerRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    return c.json(await register(db, push, userId, c.req.valid("json")), 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    if (!(await deleteDevice(db, userId, c.req.valid("param").id))) {
      throw new ApiError("not_found", "no such device");
    }
    return c.body(null, 204);
  });

  app.openapi(testRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const pusher = await requirePusher(push);
    const device = await findDevice(db, userId, c.req.valid("param").id);
    if (device === null) throw new ApiError("not_found", "no such device");
    return c.json({ outcome: testOutcome(await pusher.test(device)) }, 200);
  });
}
