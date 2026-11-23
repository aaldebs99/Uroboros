import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  EntryRef,
  KeptBody,
  LibraryItem,
  ProgressBody,
  TagsBody,
  WatchedBody,
} from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { ownEntry } from "../downloads/library.ts";
import { needStore, serve } from "../downloads/libraryRoutes.ts";
import { visibleEntry } from "../sharing/access.ts";
import { addToLibrary } from "../sharing/add.ts";
import { contentTypeOf } from "../storage/contentType.ts";
import type { MediaStore } from "../storage/index.ts";
import { extname } from "node:path";
import { getItem } from "./item.ts";
import { saveProgress, setWatched } from "./progress.ts";
import { replaceTags } from "./tags.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const binary = (description: string, type: string) => ({
  description,
  content: { [type]: { schema: z.string().openapi({ format: "binary" }) } },
});
const id = z.uuid().openapi({ param: { name: "id", in: "path" } });

const itemRoute = createRoute({
  method: "get",
  path: "/api/library/{id}",
  tags: ["library"],
  summary: "One entry with its chapters, subtitles, playlists and stream URL",
  request: { params: z.object({ id }) },
  responses: { 200: json(LibraryItem, "The entry"), 404: error("No such entry") },
});

const streamRoute = createRoute({
  method: "get",
  path: "/api/library/{id}/stream",
  tags: ["library"],
  summary: "The file inline, for the player (ranges; or a redirect to a presigned URL)",
  request: { params: z.object({ id }) },
  responses: {
    200: binary("The file", "application/octet-stream"),
    206: binary("A byte range", "application/octet-stream"),
    302: { description: "A presigned URL" },
    404: error("No such entry"),
    416: { description: "The range is past the end" },
  },
});

const subtitleRoute = createRoute({
  method: "get",
  path: "/api/library/{id}/subtitles/{subId}",
  tags: ["library"],
  summary: "One of the entry's subtitle files (WebVTT)",
  request: {
    params: z.object({ id, subId: z.uuid().openapi({ param: { name: "subId", in: "path" } }) }),
  },
  responses: { 200: binary("The subtitles", "text/vtt"), 404: error("No such subtitle") },
});

const progressRoute = createRoute({
  method: "put",
  path: "/api/library/{id}/progress",
  tags: ["library"],
  summary: "Where the caller is in this video; watched past 90%",
  request: { params: z.object({ id }), ...body(ProgressBody) },
  responses: { 204: { description: "Saved" }, 404: error("No such entry") },
});

const watchedRoute = createRoute({
  method: "put",
  path: "/api/library/{id}/watched",
  tags: ["library"],
  summary: "Mark watched or not (not also starts it over)",
  request: { params: z.object({ id }), ...body(WatchedBody) },
  responses: { 204: { description: "Saved" }, 404: error("No such entry") },
});

const keptRoute = createRoute({
  method: "put",
  path: "/api/library/{id}/kept",
  tags: ["library"],
  summary: "Keep the entry (retention never removes it) or stop keeping it",
  request: { params: z.object({ id }), ...body(KeptBody) },
  responses: { 204: { description: "Saved" }, 404: error("No such entry") },
});

const tagsRoute = createRoute({
  method: "put",
  path: "/api/library/{id}/tags",
  tags: ["library"],
  summary: "Replace the entry's tags",
  request: { params: z.object({ id }), ...body(TagsBody) },
  responses: { 200: json(TagsBody, "The tags, normalized"), 404: error("No such entry") },
});

const addRoute = createRoute({
  method: "post",
  path: "/api/library/{id}/add",
  tags: ["library"],
  summary: "Add a video shared with the caller to their own library (instant: same file)",
  request: { params: z.object({ id }) },
  responses: {
    200: json(EntryRef, "The caller already had it (their own entry on that file)"),
    201: json(EntryRef, "Added"),
    404: error("No such entry the caller may see"),
  },
});

/**
 * The item page's routes (docs/library.md). Watching (the item, its file, subtitles, progress)
 * works for entries shared with the caller too (docs/sharing.md); Keep and tags are the owner's.
 */
export function registerItemRoutes(
  app: OpenAPIHono,
  db: Kysely<Database>,
  store: MediaStore | undefined,
): void {
  app.openapi(itemRoute, async (c) =>
    c.json(await getItem(db, currentPrincipal(c).userId, c.req.valid("param").id), 200),
  );

  app.openapi(streamRoute, async (c) => {
    const s = needStore(store);
    const entry = await visibleEntry(
      db,
      { userId: currentPrincipal(c).userId },
      c.req.valid("param").id,
    );
    const ext = extname(entry.storage_key).slice(1) || (entry.container ?? "bin");
    const url = await s.downloadUrl(entry.storage_key, `${entry.video_id}.${ext}`);
    if (url !== null) return c.redirect(url, 302);
    return serve(c, s, entry.storage_key, contentTypeOf(ext), null);
  });

  app.openapi(subtitleRoute, async (c) => {
    const s = needStore(store);
    const { id: entryId, subId } = c.req.valid("param");
    const entry = await visibleEntry(db, { userId: currentPrincipal(c).userId }, entryId);
    const sub = await db
      .selectFrom("subtitles")
      .select("storage_key")
      .where("id", "=", subId)
      .where("media_id", "=", entry.media_id)
      .executeTakeFirst();
    if (sub === undefined) throw new ApiError("not_found", "no such subtitle");
    return serve(c, s, sub.storage_key, "text/vtt", null);
  });

  app.openapi(progressRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const entry = await visibleEntry(db, { userId }, c.req.valid("param").id);
    const { position, duration } = c.req.valid("json");
    await saveProgress(db, userId, entry.media_id, position, duration);
    return c.body(null, 204);
  });

  app.openapi(watchedRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const entry = await visibleEntry(db, { userId }, c.req.valid("param").id);
    await setWatched(
      db,
      userId,
      { id: entry.media_id, duration: entry.duration },
      c.req.valid("json").watched,
    );
    return c.body(null, 204);
  });

  app.openapi(addRoute, async (c) => {
    const added = await addToLibrary(db, currentPrincipal(c).userId, c.req.valid("param").id);
    return added.created ? c.json({ id: added.id }, 201) : c.json({ id: added.id }, 200);
  });

  app.openapi(keptRoute, async (c) => {
    const entry = await ownEntry(db, currentPrincipal(c).userId, c.req.valid("param").id);
    await db
      .updateTable("library_entries")
      .set({ kept: c.req.valid("json").kept })
      .where("id", "=", entry.id)
      .execute();
    return c.body(null, 204);
  });

  app.openapi(tagsRoute, async (c) => {
    const entry = await ownEntry(db, currentPrincipal(c).userId, c.req.valid("param").id);
    return c.json({ tags: await replaceTags(db, entry.id, c.req.valid("json").tags) }, 200);
  });
}
