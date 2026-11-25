import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { ApiErrorBody, DownloadEvent, type DownloadEvent as Event } from "@uroboros/contract";
import { streamSSE } from "hono/streaming";
import type { Logger } from "pino";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { requireAdmin } from "../auth/guard.ts";
import type { DownloadContext } from "./dispatch.ts";
import type { PgBus } from "../db/notifications.ts";
import type { InternalEvent } from "./events.ts";
import { allQuery, need } from "./routes.ts";
import { downloadRows, toDownloads } from "./serialize.ts";

const PING_MS = 25_000;

/** The replica's listener, fanned out to every open stream. */
export interface EventHub {
  /** Settles once the listener is in place. */
  ready: Promise<void>;
  subscribe(listener: (e: InternalEvent) => void, onClose: () => void): () => void;
  close(): void;
}

/**
 * Feeds every open download stream from the bus's `uroboros_downloads` channel. When the listener
 * reconnects, events may have been lost, so every open stream is ended: the browser reconnects and
 * refetches the list.
 */
export function createEventHub(bus: PgBus, logger: Logger): EventHub {
  const listeners = new Map<(e: InternalEvent) => void, () => void>();
  const endAll = () => {
    for (const onClose of listeners.values()) onClose();
    listeners.clear();
  };
  const offEvents = bus.on("uroboros_downloads", (message) => {
    let event: InternalEvent;
    try {
      event = JSON.parse(message) as InternalEvent;
    } catch (err) {
      logger.warn({ err }, "ignoring a malformed download event");
      return;
    }
    for (const listener of listeners.keys()) listener(event);
  });
  const offResync = bus.onResync(endAll);
  return {
    ready: bus.ready,
    subscribe(listener, onClose) {
      listeners.set(listener, onClose);
      return () => listeners.delete(listener);
    },
    close() {
      offEvents();
      offResync();
      endAll();
    },
  };
}

const eventsRoute = createRoute({
  method: "get",
  path: "/api/downloads/events",
  tags: ["downloads"],
  summary:
    "Server-sent events: the caller's download state changes and progress (all=true: everyone's, admins only), and a nudge when their notifications change",
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

/**
 * A nudge about the viewer's own things (their notifications, pasted links waiting for a pick,
 * hover previews being made, a SponsorBlock refetch), even on an admin's everyone view; null when
 * it is someone else's.
 */
function personal(
  e: Exclude<InternalEvent, { kind: "state" | "progress" }>,
  userId: string,
): Event | null {
  switch (e.kind) {
    case "notice":
      return e.userId === userId ? { type: "notice" } : null;
    case "requests":
      return e.userId === userId ? { type: "requests" } : null;
    case "previews":
      return e.userIds.includes(userId) ? { type: "previews" } : null;
    case "skips":
      return e.userId === userId
        ? { type: "skips", entryId: e.entryId, found: e.found, error: e.error }
        : null;
  }
}

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
    if (e.kind !== "state") return personal(e, viewer.userId);
    if (!viewer.all && e.userId !== viewer.userId) return null;
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
