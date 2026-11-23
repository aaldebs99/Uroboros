import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { ApiErrorBody, DownloadEvent, type DownloadEvent as Event } from "@uroboros/contract";
import { streamSSE } from "hono/streaming";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { requireAdmin } from "../auth/guard.ts";
import type { DownloadContext } from "./dispatch.ts";
import { eventsChannel, type InternalEvent } from "./events.ts";
import { allQuery, need } from "./routes.ts";
import { downloadRows, toDownloads } from "./serialize.ts";

const PING_MS = 25_000;

/** One Valkey subscription per replica, fanned out to every open stream. */
export interface EventHub {
  /** Settles once the subscription is in place (ioredis renews it after a reconnect). */
  ready: Promise<void>;
  subscribe(listener: (e: InternalEvent) => void, onClose: () => void): () => void;
  close(): void;
}

export function createEventHub(subscriber: Redis, prefix: string, logger: Logger): EventHub {
  const listeners = new Map<(e: InternalEvent) => void, () => void>();
  subscriber.on("message", (_channel, message) => {
    let event: InternalEvent;
    try {
      event = JSON.parse(message) as InternalEvent;
    } catch (err) {
      logger.warn({ err }, "ignoring a malformed download event");
      return;
    }
    for (const listener of listeners.keys()) listener(event);
  });
  // Not awaited by the caller: the api listens before Valkey may be reachable.
  const ready = subscriber.subscribe(eventsChannel(prefix)).then(
    () => undefined,
    (err: unknown) => {
      logger.warn({ err }, "subscribing to download events failed; retrying on reconnect");
    },
  );
  return {
    ready,
    subscribe(listener, onClose) {
      listeners.set(listener, onClose);
      return () => listeners.delete(listener);
    },
    close() {
      for (const onClose of listeners.values()) onClose();
      listeners.clear();
      subscriber.disconnect();
    },
  };
}

const eventsRoute = createRoute({
  method: "get",
  path: "/api/downloads/events",
  tags: ["downloads"],
  summary:
    "Server-sent events: the caller's download state changes and progress (all=true: everyone's, admins only)",
  request: { query: allQuery },
  responses: {
    200: {
      description: "An event stream; each `data:` line is a DownloadEvent",
      content: { "text/event-stream": { schema: DownloadEvent } },
    },
    403: {
      description: "all=true needs an admin",
      content: { "application/json": { schema: ApiErrorBody } },
    },
  },
});

/** Turns internal events into the caller's stream messages, tracking which fetches they wait on. */
function translator(
  ctx: DownloadContext,
  viewer: { userId: string; all: boolean },
  active: Set<string>,
) {
  return async (e: InternalEvent): Promise<Event | null> => {
    if (e.kind === "progress") {
      return viewer.all || active.has(e.fetchKey)
        ? { type: "progress", fetchKey: e.fetchKey, progress: e.progress }
        : null;
    }
    if (!viewer.all && e.userId !== viewer.userId) return null;
    if (e.kind === "removed") return { type: "removed", id: e.downloadId };
    const [download] = await toDownloads(
      ctx,
      await downloadRows(ctx.db, { userId: null, ids: [e.downloadId] }),
    );
    if (download === undefined) return null;
    if (download.state === "queued" || download.state === "running") active.add(download.fetchKey);
    else active.delete(download.fetchKey);
    return { type: "state", download };
  };
}

export function registerEventRoutes(
  app: OpenAPIHono,
  ctx: DownloadContext | undefined,
  hub: EventHub | undefined,
): void {
  app.openapi(eventsRoute, async (c) => {
    const d = need(ctx);
    if (hub === undefined) throw new ApiError("unavailable", "live events are not available");
    const principal = currentPrincipal(c);
    const all = c.req.valid("query").all === "true";
    if (all) requireAdmin(principal);
    const rows = await downloadRows(d.db, { userId: all ? null : principal.userId });
    const active = new Set(
      rows.filter((r) => r.state === "queued" || r.state === "running").map((r) => r.fetch_key),
    );
    const translate = translator(d, { userId: principal.userId, all }, active);
    return streamSSE(c, async (stream) => {
      let chain = Promise.resolve();
      let finish: () => void = () => undefined;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const unsubscribe = hub.subscribe((e) => {
        chain = chain
          .then(async () => {
            const message = await translate(e);
            if (message !== null) await stream.writeSSE({ data: JSON.stringify(message) });
          })
          .catch((err: unknown) => {
            d.logger.warn({ err }, "sending a download event failed");
          });
      }, finish);
      const ping = setInterval(() => {
        void stream.write(": ping\n\n");
      }, PING_MS);
      stream.onAbort(finish);
      await done;
      clearInterval(ping);
      unsubscribe();
    });
  });
}
