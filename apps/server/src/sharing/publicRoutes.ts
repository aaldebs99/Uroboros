import { extname } from "node:path";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorBody, PublicItem, PublicShare } from "@uroboros/contract";
import type { Context } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { needStore, serve } from "../downloads/libraryRoutes.ts";
import { contentTypeOf } from "../storage/contentType.ts";
import { sanitizeSegment, type MediaStore } from "../storage/index.ts";
import { registerSessionScope, type SessionContext } from "../transcode/sessionRoutes.ts";
import { itemBase, linkEntry, publicItem, publicShare } from "./public.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const dead = {
  description: "The link doesn't work any more",
  content: { "application/json": { schema: ApiErrorBody } },
};
const binary = (description: string, type: string) => ({
  description,
  content: { [type]: { schema: z.string().openapi({ format: "binary" }) } },
});
const code = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .openapi({ param: { name: "code", in: "path" } });
const id = z.uuid().openapi({ param: { name: "id", in: "path" } });
const tags = ["public links"];
/** Anyone may call these: the code is the key (docs/sharing.md). */
const open = { tags, security: [] as [] };

const shareRoute = createRoute({
  ...open,
  method: "get",
  path: "/api/public/s/{code}",
  summary: "What a public link shows: its title and its videos",
  request: { params: z.object({ code }) },
  responses: { 200: json(PublicShare, "The link"), 404: dead },
});

const itemRoute = createRoute({
  ...open,
  method: "get",
  path: "/api/public/s/{code}/items/{id}",
  summary: "One of a public link's videos, with what its player needs",
  request: { params: z.object({ code, id }) },
  responses: { 200: json(PublicItem, "The video"), 404: dead },
});

const streamRoute = createRoute({
  ...open,
  method: "get",
  path: "/api/public/s/{code}/items/{id}/stream",
  summary: "The file inline, for the player (ranges; or a redirect to a presigned URL)",
  request: { params: z.object({ code, id }) },
  responses: {
    200: binary("The file", "application/octet-stream"),
    206: binary("A byte range", "application/octet-stream"),
    302: { description: "A presigned URL" },
    404: dead,
  },
});

const fileRoute = createRoute({
  ...open,
  method: "get",
  path: "/api/public/s/{code}/items/{id}/file",
  summary: "Save the file, when the link allows downloads",
  request: { params: z.object({ code, id }) },
  responses: {
    200: binary("The file", "application/octet-stream"),
    302: { description: "A presigned URL" },
    404: dead,
  },
});

const thumbnailRoute = createRoute({
  ...open,
  method: "get",
  path: "/api/public/s/{code}/items/{id}/thumbnail",
  summary: "A video's thumbnail",
  request: { params: z.object({ code, id }) },
  responses: { 200: binary("The image", "image/jpeg"), 404: dead },
});

const subtitleRoute = createRoute({
  ...open,
  method: "get",
  path: "/api/public/s/{code}/items/{id}/subtitles/{subId}",
  summary: "One of a video's subtitle files (WebVTT)",
  request: {
    params: z.object({
      code,
      id,
      subId: z.uuid().openapi({ param: { name: "subId", in: "path" } }),
    }),
  },
  responses: { 200: binary("The subtitles", "text/vtt"), 404: dead },
});

const noStore = { "cache-control": "no-store" };

/** Public links' routes, outside the sign-in guard: each checks its own code. */
export function registerPublicRoutes(
  app: OpenAPIHono,
  db: Kysely<Database>,
  store: MediaStore | undefined,
  playback: SessionContext | undefined,
): void {
  // Before the routes, so it wraps them: a link's pages are never for search engines.
  app.use("/api/public/*", async (c, next) => {
    await next();
    c.res.headers.set("x-robots-tag", "noindex");
  });
  const params = (c: Context) => ({ code: c.req.param("code") ?? "", id: c.req.param("id") ?? "" });

  app.openapi(shareRoute, async (c) =>
    c.json(await publicShare(db, c.req.valid("param").code), 200, noStore),
  );
  app.openapi(itemRoute, async (c) => {
    const p = c.req.valid("param");
    return c.json(await publicItem(db, p.code, p.id, playback?.maxShort), 200, noStore);
  });
  app.openapi(streamRoute, async (c) => {
    const s = needStore(store);
    const p = c.req.valid("param");
    const e = await linkEntry(db, p.code, p.id);
    const ext = extname(e.storage_key).slice(1) || (e.container ?? "bin");
    const url = await s.downloadUrl(e.storage_key, `${e.video_id}.${ext}`);
    if (url !== null) return c.redirect(url, 302);
    return serve(c, s, e.storage_key, contentTypeOf(ext), null);
  });
  app.openapi(fileRoute, async (c) => {
    const s = needStore(store);
    const p = c.req.valid("param");
    const e = await linkEntry(db, p.code, p.id);
    if (!e.allow_download) throw new ApiError("not_found", "this link does not offer downloads");
    const ext = extname(e.storage_key).slice(1) || (e.container ?? "bin");
    const filename = `${sanitizeSegment(e.title ?? e.video_id)}.${ext}`;
    const url = await s.downloadUrl(e.storage_key, filename);
    if (url !== null) return c.redirect(url, 302);
    return serve(c, s, e.storage_key, contentTypeOf(ext), filename);
  });
  app.openapi(thumbnailRoute, async (c) => {
    const s = needStore(store);
    const p = c.req.valid("param");
    const e = await linkEntry(db, p.code, p.id);
    if (e.thumbnail_key === null) throw new ApiError("not_found", "no thumbnail");
    return serve(c, s, e.thumbnail_key, contentTypeOf(extname(e.thumbnail_key).slice(1)), null);
  });
  app.openapi(subtitleRoute, async (c) => {
    const s = needStore(store);
    const p = c.req.valid("param");
    const e = await linkEntry(db, p.code, p.id);
    const sub = await db
      .selectFrom("subtitles")
      .select("storage_key")
      .where("id", "=", p.subId)
      .where("media_id", "=", e.media_id)
      .executeTakeFirst();
    if (sub === undefined) throw new ApiError("not_found", "no such subtitle");
    return serve(c, s, sub.storage_key, "text/vtt", null);
  });
  registerSessionScope(
    app,
    {
      path: "/api/public/s/{code}/items/{id}/playback",
      params: z.object({ code, id }),
      tags,
      security: [],
      resolve: (c) => {
        const p = params(c);
        return {
          viewer: { code: p.code },
          entryId: p.id,
          base: `${itemBase(p.code, p.id)}/playback`,
        };
      },
    },
    playback,
  );
}
