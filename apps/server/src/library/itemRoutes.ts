import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  EntryDetailsBody,
  EntryRef,
  KeptBody,
  LibraryItem,
  ProgressBody,
  TagsBody,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_TYPES,
  WatchedBody,
} from "@uroboros/contract";
import { bodyLimit } from "hono/body-limit";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { DownloadQueues } from "../downloads/queues.ts";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { ownEntry } from "../downloads/library.ts";
import { needStore, serve } from "../downloads/libraryRoutes.ts";
import { visibleEntry } from "../sharing/access.ts";
import { addToLibrary } from "../sharing/add.ts";
import { contentTypeOf } from "../storage/contentType.ts";
import type { StorageConfig } from "../storage/config.ts";
import type { MediaStore } from "../storage/index.ts";
import { extname } from "node:path";
import { editDetails, replaceThumbnail } from "./details.ts";
import { getItem } from "./item.ts";
import { setKept } from "./kept.ts";
import { saveProgress, setWatched } from "./progress.ts";
import { requestSkipsRefetch } from "./skipRefetch.ts";
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

const refetchSkipsRoute = createRoute({
  method: "post",
  path: "/api/library/{id}/skip-segments/refetch",
  tags: ["library"],
  summary: "Fetch the video's SponsorBlock segments again; a `skips` live event says how it went",
  request: { params: z.object({ id }) },
  responses: {
    202: { description: "Queued (or already on its way)" },
    404: error("No such entry of the caller's own"),
    409: error("The video has no SponsorBlock segments to fetch"),
    503: error("Downloads are not available"),
  },
});

const detailsRoute = createRoute({
  method: "patch",
  path: "/api/library/{id}/details",
  tags: ["library"],
  summary: "Change an uploaded video's title, description and creator (its uploader only)",
  request: { params: z.object({ id }), ...body(EntryDetailsBody) },
  responses: {
    200: json(LibraryItem, "The item as it is now"),
    400: error("A blank title or creator, or one too long"),
    403: error("A downloaded video, or someone else's upload"),
    404: error("Not the caller's entry"),
  },
});

const thumbnailPutRoute = createRoute({
  method: "put",
  path: "/api/library/{id}/thumbnail",
  tags: ["library"],
  summary: "Replace an uploaded video's thumbnail: a JPEG, PNG or WebP image (its uploader only)",
  middleware: [bodyLimit({ maxSize: THUMBNAIL_MAX_BYTES })] as const,
  request: {
    params: z.object({ id }),
    body: {
      required: true,
      description: "The image",
      content: Object.fromEntries(
        THUMBNAIL_TYPES.map((t) => [t, { schema: z.string().openapi({ format: "binary" }) }]),
      ),
    },
  },
  responses: {
    200: json(LibraryItem, "The item with its new thumbnail"),
    400: error("Not a JPEG, PNG or WebP image"),
    403: error("A downloaded video, or someone else's upload"),
    404: error("Not the caller's entry"),
    413: error("Over 5 MiB"),
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
  storage: StorageConfig | undefined,
  probe: DownloadQueues["probe"] | undefined,
  maxShort: number,
): void {
  app.openapi(itemRoute, async (c) =>
    c.json(await getItem(db, currentPrincipal(c).userId, c.req.valid("param").id, maxShort), 200),
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
    await setKept(
      db,
      currentPrincipal(c).userId,
      c.req.valid("param").id,
      c.req.valid("json").kept,
    );
    return c.body(null, 204);
  });

  app.openapi(refetchSkipsRoute, async (c) => {
    await requestSkipsRefetch(db, probe, currentPrincipal(c).userId, c.req.valid("param").id);
    return c.body(null, 202);
  });

  app.openapi(detailsRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const { id: entryId } = c.req.valid("param");
    await editDetails(db, userId, entryId, c.req.valid("json"));
    return c.json(await getItem(db, userId, entryId, maxShort), 200);
  });

  app.openapi(thumbnailPutRoute, async (c) => {
    const s = needStore(store);
    if (storage === undefined) throw new ApiError("unavailable", "storage is not available");
    const { userId } = currentPrincipal(c);
    const { id: entryId } = c.req.valid("param");
    const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
    await replaceThumbnail(db, s, storage, userId, entryId, bytes);
    return c.json(await getItem(db, userId, entryId, maxShort), 200);
  });

  app.openapi(tagsRoute, async (c) => {
    const entry = await ownEntry(db, currentPrincipal(c).userId, c.req.valid("param").id);
    return c.json({ tags: await replaceTags(db, entry.id, c.req.valid("json").tags) }, 200);
  });
}
