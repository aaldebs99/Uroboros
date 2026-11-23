import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorBody, Playback } from "@uroboros/contract";
import type { Context } from "hono";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import type { MediaStore } from "../storage/index.ts";
import { attemptPrefix } from "./keys.ts";
import { ensurePlayback, getPlayback, ownCopy, type PlaybackContext } from "./playback.ts";
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
const tags = ["library"];
const M3U8 = "application/vnd.apple.mpegurl";
/** A copy's files never change once stored (each attempt has its own folder). */
const IMMUTABLE = "private, max-age=31536000, immutable";
const FILE = /^(init\.mp4|seg-\d{5}\.m4s)$/;

const askRoute = createRoute({
  method: "post",
  path: "/api/library/{id}/playback",
  tags,
  summary: "Ask for a copy of the entry this browser can play (made once, then kept)",
  request: { params: z.object({ id }) },
  responses: {
    200: json(Playback, "The copy and how far along it is"),
    404: error("No such entry"),
  },
});

const stateRoute = createRoute({
  method: "get",
  path: "/api/library/{id}/playback",
  tags,
  summary: "How far along the entry's compatible copy is",
  request: { params: z.object({ id }) },
  responses: { 200: json(Playback, "The copy"), 404: error("No such entry, or no copy asked for") },
});

const masterRoute = createRoute({
  method: "get",
  path: "/api/library/{id}/playback/master.m3u8",
  tags,
  summary: "The copy's multivariant HLS playlist",
  request: { params: z.object({ id }) },
  responses: {
    200: text("The playlist", M3U8),
    404: error("No such entry or copy"),
    409: error("The copy has not started yet"),
  },
});

const playlistRoute = createRoute({
  method: "get",
  path: "/api/library/{id}/playback/{attempt}/index.m3u8",
  tags,
  summary: "The copy's media playlist, which grows as segments are stored",
  request: { params: z.object({ id, attempt }) },
  responses: { 200: text("The playlist", M3U8), 404: error("Not stored, or another attempt") },
});

const fileRoute = createRoute({
  method: "get",
  path: "/api/library/{id}/playback/{attempt}/{file}",
  tags,
  summary: "One of the copy's files: init.mp4 or seg-NNNNN.m4s",
  request: {
    params: z.object({
      id,
      attempt,
      file: z.string().openapi({ param: { name: "file", in: "path" } }),
    }),
  },
  responses: { 200: text("The file", "video/mp4"), 404: error("No such file") },
});

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
async function attemptFolder(c: Context, p: PlaybackContext, entryId: string, wanted: string) {
  const row = await ownCopy(p, currentPrincipal(c).userId, entryId);
  if (row?.attempt !== Number(wanted)) throw new ApiError("not_found", "no such copy");
  return { row, prefix: attemptPrefix(row.id, row.attempt) };
}

export function registerPlaybackRoutes(
  app: OpenAPIHono,
  ctx: PlaybackContext | undefined,
  store: MediaStore | undefined,
): void {
  app.openapi(askRoute, async (c) => {
    const { ctx: p } = need(ctx, store);
    return c.json(
      await ensurePlayback(p, currentPrincipal(c).userId, c.req.valid("param").id),
      200,
    );
  });

  app.openapi(stateRoute, async (c) => {
    const { ctx: p } = need(ctx, store);
    const playback = await getPlayback(p, currentPrincipal(c).userId, c.req.valid("param").id);
    if (playback === null) throw new ApiError("not_found", "no copy has been asked for");
    return c.json(playback, 200);
  });

  app.openapi(masterRoute, async (c) => {
    const { ctx: p } = need(ctx, store);
    const row = await ownCopy(p, currentPrincipal(c).userId, c.req.valid("param").id);
    if (row === undefined) throw new ApiError("not_found", "no copy has been asked for");
    if (row.mode === null || row.codecs === null) {
      throw new ApiError("conflict", "the copy has not started yet");
    }
    return c.body(masterPlaylist({ ...row, mode: row.mode, codecs: row.codecs }), 200, {
      "content-type": M3U8,
      "cache-control": "no-store",
    });
  });

  app.openapi(playlistRoute, async (c) => {
    const { ctx: p, store: s } = need(ctx, store);
    const { id: entryId, attempt: wanted } = c.req.valid("param");
    const { prefix } = await attemptFolder(c, p, entryId, wanted);
    return serveStored(c, s, `${prefix}index.m3u8`, M3U8, "no-store");
  });

  app.openapi(fileRoute, async (c) => {
    const { ctx: p, store: s } = need(ctx, store);
    const { id: entryId, attempt: wanted, file } = c.req.valid("param");
    if (!FILE.test(file)) throw new ApiError("not_found", "no such file");
    const { row, prefix } = await attemptFolder(c, p, entryId, wanted);
    const type = row.mode === "audio" ? "audio/mp4" : "video/mp4";
    return serveStored(c, s, `${prefix}${file}`, type, IMMUTABLE);
  });
}
