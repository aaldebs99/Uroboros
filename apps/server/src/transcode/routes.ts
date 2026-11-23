import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorBody, Playback } from "@uroboros/contract";
import type { Context } from "hono";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import type { MediaStore } from "../storage/index.ts";
import { attemptPrefix } from "./keys.ts";
import type { Viewer } from "../sharing/access.ts";
import { copyFor, ensurePlayback, getPlayback, type PlaybackContext } from "./playback.ts";
import { masterPlaylist } from "./playlists.ts";

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
const attempt = z
  .string()
  .regex(/^\d{1,6}$/)
  .openapi({ param: { name: "attempt", in: "path" } });
const M3U8 = "application/vnd.apple.mpegurl";
/** A copy's files never change once stored (each attempt has its own folder). */
const IMMUTABLE = "private, max-age=31536000, immutable";
const FILE = /^(init\.mp4|seg-\d{5}\.m4s)$/;

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

/** The five playback routes of a scope. */
function scopeRoutes(scope: PlaybackScope) {
  const common = { tags: scope.tags, ...(scope.security ? { security: scope.security } : {}) };
  const ask = createRoute({
    ...common,
    method: "post",
    path: scope.path,
    summary: "Ask for a copy of the entry this browser can play (made once, then kept)",
    request: { params: scope.params },
    responses: {
      200: json(Playback, "The copy and how far along it is"),
      404: error("No such entry"),
    },
  });
  const state = createRoute({
    ...common,
    method: "get",
    path: scope.path,
    summary: "How far along the entry's compatible copy is",
    request: { params: scope.params },
    responses: {
      200: json(Playback, "The copy"),
      404: error("No such entry, or no copy asked for"),
    },
  });
  const master = createRoute({
    ...common,
    method: "get",
    path: `${scope.path}/master.m3u8`,
    summary: "The copy's multivariant HLS playlist",
    request: { params: scope.params },
    responses: {
      200: text("The playlist", M3U8),
      404: error("No such entry or copy"),
      409: error("The copy has not started yet"),
    },
  });
  const playlist = createRoute({
    ...common,
    method: "get",
    path: `${scope.path}/{attempt}/index.m3u8`,
    summary: "The copy's media playlist, which grows as segments are stored",
    request: { params: scope.params.extend({ attempt }) },
    responses: { 200: text("The playlist", M3U8), 404: error("Not stored, or another attempt") },
  });
  const file = createRoute({
    ...common,
    method: "get",
    path: `${scope.path}/{attempt}/{file}`,
    summary: "One of the copy's files: init.mp4 or seg-NNNNN.m4s",
    request: {
      params: scope.params.extend({
        attempt,
        file: z.string().openapi({ param: { name: "file", in: "path" } }),
      }),
    },
    responses: { 200: text("The file", "video/mp4"), 404: error("No such file") },
  });
  return { ask, state, master, playlist, file };
}

/** The playback routes need queues and storage; `gen` and tests without them get 503. */
function need(ctx: PlaybackContext | undefined, store: MediaStore | undefined) {
  if (ctx === undefined || store === undefined) {
    throw new ApiError("unavailable", "playback copies are not available");
  }
  return { ctx, store };
}

/** Streams a stored file through the api (same-origin for MSE), whole. */
async function serveStored(
  c: Context,
  store: MediaStore,
  key: string,
  type: string,
  cache: string,
) {
  const stat = await store.stat(key);
  if (stat === null) throw new ApiError("not_found", "no such file");
  const opened = await store.open(key);
  return c.body(opened.body, 200, {
    "content-type": type,
    "content-length": String(stat.size),
    "cache-control": cache,
  });
}

/** The copy's current attempt's folder, or 404 for another attempt. */
async function attemptFolder(p: PlaybackContext, viewer: Viewer, entryId: string, wanted: string) {
  const row = await copyFor(p, viewer, entryId);
  if (row?.attempt !== Number(wanted)) throw new ApiError("not_found", "no such copy");
  return { row, prefix: attemptPrefix(row.id, row.attempt) };
}

/** Registers one scope's playback routes (docs/transcoding.md). */
export function registerPlaybackScope(
  app: OpenAPIHono,
  scope: PlaybackScope,
  ctx: PlaybackContext | undefined,
  store: MediaStore | undefined,
): void {
  const r = scopeRoutes(scope);
  app.openapi(r.ask, async (c) => {
    const { ctx: p } = need(ctx, store);
    const { viewer, entryId, base } = scope.resolve(c);
    return c.json(await ensurePlayback(p, viewer, entryId, base), 200);
  });

  app.openapi(r.state, async (c) => {
    const { ctx: p } = need(ctx, store);
    const { viewer, entryId, base } = scope.resolve(c);
    const playback = await getPlayback(p, viewer, entryId, base);
    if (playback === null) throw new ApiError("not_found", "no copy has been asked for");
    return c.json(playback, 200);
  });

  app.openapi(r.master, async (c) => {
    const { ctx: p } = need(ctx, store);
    const { viewer, entryId } = scope.resolve(c);
    const row = await copyFor(p, viewer, entryId);
    if (row === undefined) throw new ApiError("not_found", "no copy has been asked for");
    if (row.mode === null || row.codecs === null) {
      throw new ApiError("conflict", "the copy has not started yet");
    }
    return c.body(masterPlaylist({ ...row, mode: row.mode, codecs: row.codecs }), 200, {
      "content-type": M3U8,
      "cache-control": "no-store",
    });
  });

  app.openapi(r.playlist, async (c) => {
    const { ctx: p, store: s } = need(ctx, store);
    const { viewer, entryId } = scope.resolve(c);
    const { prefix } = await attemptFolder(p, viewer, entryId, c.req.param("attempt"));
    return serveStored(c, s, `${prefix}index.m3u8`, M3U8, "no-store");
  });

  app.openapi(r.file, async (c) => {
    const { ctx: p, store: s } = need(ctx, store);
    const { viewer, entryId } = scope.resolve(c);
    const file = c.req.param("file");
    if (!FILE.test(file)) throw new ApiError("not_found", "no such file");
    const { row, prefix } = await attemptFolder(p, viewer, entryId, c.req.param("attempt"));
    const type = row.mode === "audio" ? "audio/mp4" : "video/mp4";
    return serveStored(c, s, `${prefix}${file}`, type, IMMUTABLE);
  });
}

/** The signed-in playback routes, under `/api/library/{id}/playback`. */
export function registerPlaybackRoutes(
  app: OpenAPIHono,
  ctx: PlaybackContext | undefined,
  store: MediaStore | undefined,
): void {
  registerPlaybackScope(
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
    store,
  );
}
