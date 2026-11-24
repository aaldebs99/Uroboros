import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorBody, PlaybackRequest, PlaybackSession } from "@uroboros/contract";
import type { Context } from "hono";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { visibleEntry, type Viewer } from "../sharing/access.ts";
import type { MediaStore } from "../storage/index.ts";
import { type PlaybackBus, touchAlive, waitForSegment } from "./bus.ts";
import { masterPlaylist, mediaPlaylist } from "./hls.ts";
import { addPlaybackJob } from "./sessionQueue.ts";
import {
  checkLinkLimit,
  initKey,
  insertSession,
  isLive,
  planFor,
  planOf,
  segmentKey,
  type SessionRow,
  stopSession,
  stopViewerSessions,
  toSession,
  viewerSession,
} from "./sessions.ts";

/** What the session routes need: queues and Valkey, storage, and the replicas' playback bus. */
export interface SessionContext extends DownloadContext {
  store: MediaStore;
  bus: PlaybackBus;
  /** How long a segment request waits for the runner to make it. */
  waitMs: number;
}

/** A segment request waits this long for the runner before answering 503. */
export const SEGMENT_WAIT_MS = 45_000;

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const text = (description: string, type: string) => ({
  description,
  content: { [type]: { schema: z.string() } },
});
const id = z.uuid().openapi({ param: { name: "id", in: "path" } });
const sid = z.uuid().openapi({ param: { name: "sid", in: "path" } });
const M3U8 = "application/vnd.apple.mpegurl";
/** The session's id is in every URL, so its files never change under one. */
const IMMUTABLE = "private, max-age=31536000, immutable";
const FILE = /^(?:init\.mp4|seg-(\d{1,6})\.m4s)$/;

/** Where a set of playback routes lives and who asks through it. */
export interface PlaybackScope {
  /** The entry's playback path, e.g. `/api/library/{id}/playback`. */
  path: string;
  /** The path's own parameters (the entry's `id`, and any before it). */
  params: z.ZodObject<{ id: typeof id } & Record<string, z.ZodType>>;
  tags: string[];
  /** `[]` for routes anyone may call (a public link's). */
  security?: [];
  /** The viewer, the entry, and the base its URLs are built on, from the request. */
  resolve: (c: Context) => { viewer: Viewer; entryId: string; base: string };
}

function scopeRoutes(scope: PlaybackScope) {
  const common = { tags: scope.tags, ...(scope.security ? { security: scope.security } : {}) };
  const one = scope.params.extend({ sid });
  const session = `${scope.path}/sessions/{sid}`;
  return {
    create: createRoute({
      ...common,
      method: "post",
      path: scope.path,
      summary:
        "Play the entry other than directly: remuxed or transcoded on the fly, from a position",
      request: {
        params: scope.params,
        body: { content: { "application/json": { schema: PlaybackRequest } } },
      },
      responses: {
        201: json(PlaybackSession, "The session, queued"),
        404: error("No such entry"),
        409: error("The video's length is unknown"),
        429: error("A public link already plays on its limit of screens"),
      },
    }),
    state: createRoute({
      ...common,
      method: "get",
      path: session,
      summary: "A playback session's state; asking keeps it alive",
      request: { params: one },
      responses: { 200: json(PlaybackSession, "The session"), 404: error("No such session") },
    }),
    stop: createRoute({
      ...common,
      method: "delete",
      path: session,
      summary: "Stop a playback session",
      request: { params: one },
      responses: { 204: { description: "Stopped" }, 404: error("No such session") },
    }),
    master: createRoute({
      ...common,
      method: "get",
      path: `${session}/master.m3u8`,
      summary: "The session's multivariant HLS playlist",
      request: { params: one },
      responses: { 200: text("The playlist", M3U8), 404: error("No such live session") },
    }),
    media: createRoute({
      ...common,
      method: "get",
      path: `${session}/index.m3u8`,
      summary: "The session's media playlist: the whole video, every segment, ended",
      request: { params: one },
      responses: {
        200: text("The playlist", M3U8),
        404: error("No such live session"),
        409: error("The session is still preparing"),
      },
    }),
    file: createRoute({
      ...common,
      method: "get",
      path: `${session}/{file}`,
      summary: "init.mp4 or seg-N.m4s, made on demand if it isn't yet (the request waits)",
      request: {
        params: one.extend({ file: z.string().openapi({ param: { name: "file", in: "path" } }) }),
      },
      responses: {
        200: text("The file", "video/mp4"),
        404: error("No such file or session"),
        503: error("Not made in time; ask again"),
      },
    }),
  };
}

/** The session routes need queues, storage and the bus; `gen` and tests without them get 503. */
function need(ctx: SessionContext | undefined): SessionContext {
  if (ctx === undefined) throw new ApiError("unavailable", "playback sessions are not available");
  return ctx;
}

/** The viewer's live session, after checking they may still see the entry; keeps it alive. */
async function liveSession(ctx: SessionContext, scope: PlaybackScope, c: Context) {
  const { viewer, entryId, base } = scope.resolve(c);
  await visibleEntry(ctx.db, viewer, entryId);
  const row = await viewerSession(ctx.db, viewer, entryId, c.req.param("sid") ?? "");
  if (!isLive(row)) throw new ApiError("not_found", "the playback session has ended");
  await touchAlive(ctx, row.id);
  return { row, base };
}

/** Segment `n` (-1: the init), waited for when it isn't stored yet. */
async function serveFile(ctx: SessionContext, c: Context, row: SessionRow, n: number) {
  const segments = row.boundaries === null ? null : row.boundaries.length - 1;
  if (n >= 0 && segments !== null && n >= segments)
    throw new ApiError("not_found", "no such segment");
  const ok = await waitForSegment({
    valkey: ctx.valkey,
    prefix: ctx.prefix,
    bus: ctx.bus,
    sid: row.id,
    n,
    timeoutMs: ctx.waitMs,
    signal: c.req.raw.signal,
  });
  if (!ok) throw new ApiError("unavailable", "the segment is not ready yet");
  const key = n === -1 ? initKey(row.id) : segmentKey(row.id, n);
  const stat = await ctx.store.stat(key);
  if (stat === null) throw new ApiError("not_found", "no such segment");
  const opened = await ctx.store.open(key);
  return c.body(opened.body, 200, {
    "content-type": row.mode === "audio" ? "audio/mp4" : "video/mp4",
    "content-length": String(stat.size),
    "cache-control": IMMUTABLE,
  });
}

function playlist(c: Context, body: string) {
  return c.body(body, 200, { "content-type": M3U8, "cache-control": "no-store" });
}

/** Registers one scope's playback session routes (docs/transcoding.md). */
export function registerSessionScope(
  app: OpenAPIHono,
  scope: PlaybackScope,
  context: SessionContext | undefined,
): void {
  const r = scopeRoutes(scope);
  app.openapi(r.create, async (c) => {
    const ctx = need(context);
    const { viewer, entryId, base } = scope.resolve(c);
    const seen = await visibleEntry(ctx.db, viewer, entryId);
    const { plan, boundaries } = await planFor(ctx.db, seen.rendition_id, c.req.valid("json"));
    for (const stopped of await stopViewerSessions(ctx.db, viewer, entryId)) {
      await ctx.bus.publish({ t: "stop", sid: stopped });
    }
    await checkLinkLimit(ctx.db, viewer);
    const row = await insertSession(ctx.db, {
      renditionId: seen.rendition_id,
      entryId,
      viewer,
      plan,
      boundaries,
    });
    await touchAlive(ctx, row.id);
    await addPlaybackJob(ctx.queues.playback, row.id);
    return c.json(toSession(row, base), 201);
  });

  app.openapi(r.state, async (c) => {
    const ctx = need(context);
    const { viewer, entryId, base } = scope.resolve(c);
    await visibleEntry(ctx.db, viewer, entryId);
    const row = await viewerSession(ctx.db, viewer, entryId, c.req.param("sid") ?? "");
    if (isLive(row)) await touchAlive(ctx, row.id);
    return c.json(toSession(row, base), 200);
  });

  app.openapi(r.stop, async (c) => {
    const ctx = need(context);
    const { viewer, entryId } = scope.resolve(c);
    const row = await viewerSession(ctx.db, viewer, entryId, c.req.param("sid") ?? "");
    if (await stopSession(ctx.db, row.id)) await ctx.bus.publish({ t: "stop", sid: row.id });
    return c.body(null, 204);
  });

  app.openapi(r.master, async (c) => {
    const { row } = await liveSession(need(context), scope, c);
    const plan = planOf(row);
    return playlist(
      c,
      masterPlaylist({
        bandwidth: plan.bandwidth,
        codecs: plan.codecs,
        resolution:
          plan.width === null || plan.height === null
            ? null
            : { width: plan.width, height: plan.height },
        media: "index.m3u8",
      }),
    );
  });

  app.openapi(r.media, async (c) => {
    const { row } = await liveSession(need(context), scope, c);
    if (row.boundaries === null) throw new ApiError("conflict", "the session is still preparing");
    return playlist(
      c,
      mediaPlaylist(row.boundaries, { init: "init.mp4", segment: (n) => `seg-${String(n)}.m4s` }),
    );
  });

  app.openapi(r.file, async (c) => {
    const ctx = need(context);
    const m = FILE.exec(c.req.param("file"));
    if (m === null) throw new ApiError("not_found", "no such file");
    const { row } = await liveSession(ctx, scope, c);
    return serveFile(ctx, c, row, m[1] === undefined ? -1 : Number(m[1]));
  });
}

/** The signed-in playback routes, under `/api/library/{id}/playback`. */
export function registerPlaybackSessionRoutes(
  app: OpenAPIHono,
  ctx: SessionContext | undefined,
): void {
  registerSessionScope(
    app,
    {
      path: "/api/library/{id}/playback",
      params: z.object({ id }),
      tags: ["library"],
      resolve: (c) => {
        const entryId = c.req.param("id") ?? "";
        return {
          viewer: { userId: currentPrincipal(c).userId },
          entryId,
          base: `/api/library/${entryId}/playback`,
        };
      },
    },
    ctx,
  );
}
