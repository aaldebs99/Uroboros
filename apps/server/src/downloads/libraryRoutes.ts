import { extname } from "node:path";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  ChannelSummary,
  LIBRARY_PAGE_SIZE,
  LibraryKind,
  LibraryPage,
  LibrarySort,
} from "@uroboros/contract";
import type { Context } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { contentTypeOf } from "../storage/contentType.ts";
import { sanitizeSegment, type MediaStore } from "../storage/index.ts";
import { listChannels } from "../library/channels.ts";
import { listLibraryPage } from "../library/query.ts";
import { visibleEntry } from "../sharing/access.ts";
import { removeEntry } from "./library.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const binary = (description: string, type: string) => ({
  description,
  content: { [type]: { schema: z.string().openapi({ format: "binary" }) } },
});
const idParams = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" } }) });

const libraryQuery = z.object({
  q: z
    .string()
    .max(1000)
    .optional()
    .openapi({
      param: { name: "q", in: "query" },
      description:
        'Search: 3–200 characters, every word (or "quoted phrase") found within one title with its channel and description, one chapter title, or one run of caption lines; best place first, then newest',
    }),
  url: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .optional()
    .openapi({
      param: { name: "url", in: "query" },
      description: "A pasted link: the entries of the video it points at",
    }),
  channel: z
    .string()
    .max(1000)
    .optional()
    .openapi({ param: { name: "channel", in: "query" }, description: "A channel key" }),
  source: z
    .uuid()
    .optional()
    .openapi({ param: { name: "source", in: "query" }, description: "A YouTube playlist's id" }),
  playlist: z
    .uuid()
    .optional()
    .openapi({ param: { name: "playlist", in: "query" }, description: "A manual playlist's id" }),
  tag: z
    .string()
    .max(64)
    .optional()
    .openapi({ param: { name: "tag", in: "query" } }),
  watched: z
    .enum(["true", "false"])
    .optional()
    .openapi({ param: { name: "watched", in: "query" } }),
  inPlaylist: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      param: { name: "inPlaylist", in: "query" },
      description:
        "true: only videos in one of the caller's playlists (a YouTube one they have, or their own); false: only videos in none",
    }),
  kind: LibraryKind.optional().openapi({
    param: { name: "kind", in: "query" },
    description:
      "video: only files with a picture; audio: only files with sound alone, such as an audio-only download",
  }),
  sort: LibrarySort.optional().openapi({ param: { name: "sort", in: "query" } }),
  cursor: z
    .string()
    .max(2000)
    .optional()
    .openapi({ param: { name: "cursor", in: "query" } }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIBRARY_PAGE_SIZE)
    .optional()
    .openapi({
      param: { name: "limit", in: "query" },
      description: `Entries per page (default ${String(LIBRARY_PAGE_SIZE)})`,
    }),
});

const listRoute = createRoute({
  method: "get",
  path: "/api/library",
  tags: ["library"],
  summary: "A page of the caller's library: search, filters and sort (docs/library.md)",
  request: { query: libraryQuery },
  responses: {
    200: json(LibraryPage, "A page"),
    400: error(
      "A bad cursor, channel key, link or limit, a sort that needs another parameter, or a search that is too short or too long",
    ),
    404: error("A playlist that is not the caller's"),
    503: error("The search took too long"),
  },
});

const channelsRoute = createRoute({
  method: "get",
  path: "/api/library/channels",
  tags: ["library"],
  summary: "The channels in the caller's library, most entries first",
  responses: { 200: json(z.array(ChannelSummary), "Channels") },
});

const removeRoute = createRoute({
  method: "delete",
  path: "/api/library/{id}",
  tags: ["library"],
  summary: "Remove an entry from the caller's library (the shared file stays)",
  request: { params: idParams },
  responses: { 204: { description: "Removed" }, 404: error("No such entry") },
});

const fileRoute = createRoute({
  method: "get",
  path: "/api/library/{id}/file",
  tags: ["library"],
  summary: "Save the file (own or shared): streamed with range support, or a presigned redirect",
  request: { params: idParams },
  responses: {
    200: binary("The file", "application/octet-stream"),
    206: binary("A byte range of it", "application/octet-stream"),
    302: { description: "A presigned URL (S3 with a public URL set)" },
    404: error("No such entry, or the file is missing"),
    416: { description: "The range is past the end" },
  },
});

const thumbnailRoute = createRoute({
  method: "get",
  path: "/api/library/{id}/thumbnail",
  tags: ["library"],
  summary: "The entry's thumbnail",
  request: { params: idParams },
  responses: { 200: binary("The image", "image/jpeg"), 404: error("No such entry or thumbnail") },
});

const previewRoute = createRoute({
  method: "get",
  path: "/api/library/{id}/preview",
  tags: ["library"],
  summary: "The entry's hover preview",
  description:
    'The whole video at 480p with its sound, made once after the download (docs/library.md "Hover previews").',
  request: { params: idParams },
  responses: {
    200: binary("The preview", "video/mp4"),
    206: binary("A byte range of it", "video/mp4"),
    404: error("No such entry, or no preview yet"),
    416: { description: "The range is past the end" },
  },
});

type Range = { start: number; end: number };

/** A single `bytes=` range within `size`; "invalid" for one that cannot be served, null for none. */
export function parseRange(header: string | undefined, size: number): Range | "invalid" | null {
  if (header === undefined) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null) return null;
  const [, from = "", to = ""] = m;
  if (from === "" && to === "") return null;
  if (from === "") {
    const length = Math.min(Number(to), size);
    return length === 0 ? "invalid" : { start: size - length, end: size - 1 };
  }
  const start = Number(from);
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  return start >= size || end < start ? "invalid" : { start, end };
}

const disposition = (filename: string) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;

export async function serve(
  c: Context,
  store: MediaStore,
  key: string,
  type: string,
  filename: string | null,
) {
  const stat = await store.stat(key);
  if (stat === null) throw new ApiError("not_found", "the file is missing from storage");
  const range = parseRange(c.req.header("range"), stat.size);
  if (range === "invalid") {
    return c.body(null, 416, { "content-range": `bytes */${String(stat.size)}` });
  }
  const opened = await store.open(key, range ?? undefined);
  const headers: Record<string, string> = {
    "content-type": type,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=86400",
    "content-length": String(range === null ? stat.size : range.end - range.start + 1),
    ...(filename === null ? {} : { "content-disposition": disposition(filename) }),
    ...(range === null
      ? {}
      : {
          "content-range": `bytes ${String(range.start)}-${String(range.end)}/${String(stat.size)}`,
        }),
  };
  return c.body(opened.body, range === null ? 200 : 206, headers);
}

export function needStore(store: MediaStore | undefined): MediaStore {
  if (store === undefined) throw new ApiError("unavailable", "storage is not available");
  return store;
}

export function registerLibraryRoutes(
  app: OpenAPIHono,
  db: Kysely<Database>,
  store: MediaStore | undefined,
): void {
  // Literal paths first, so they are never taken for an entry id.
  app.openapi(listRoute, async (c) => {
    const { watched, inPlaylist, ...rest } = c.req.valid("query");
    const page = await listLibraryPage(db, currentPrincipal(c).userId, {
      ...rest,
      ...(watched === undefined ? {} : { watched: watched === "true" }),
      ...(inPlaylist === undefined ? {} : { inPlaylist: inPlaylist === "true" }),
    });
    return c.json(page, 200);
  });
  app.openapi(channelsRoute, async (c) =>
    c.json(await listChannels(db, currentPrincipal(c).userId), 200),
  );

  app.openapi(removeRoute, async (c) => {
    await removeEntry(db, currentPrincipal(c).userId, c.req.valid("param").id);
    return c.body(null, 204);
  });

  app.openapi(fileRoute, async (c) => {
    const s = needStore(store);
    const viewer = { userId: currentPrincipal(c).userId };
    const entry = await visibleEntry(db, viewer, c.req.valid("param").id);
    const ext = extname(entry.storage_key).slice(1) || (entry.container ?? "bin");
    const title = sanitizeSegment(entry.title ?? entry.video_id);
    // An upload has no profile to name (nor has a download whose profile went with its owner).
    const filename =
      entry.profile_name === null ? `${title}.${ext}` : `${title} [${entry.profile_name}].${ext}`;
    const url = await s.downloadUrl(entry.storage_key, filename);
    if (url !== null) return c.redirect(url, 302);
    return serve(c, s, entry.storage_key, contentTypeOf(ext), filename);
  });

  app.openapi(thumbnailRoute, async (c) => {
    const s = needStore(store);
    const viewer = { userId: currentPrincipal(c).userId };
    const entry = await visibleEntry(db, viewer, c.req.valid("param").id);
    if (entry.thumbnail_key === null) throw new ApiError("not_found", "no thumbnail");
    return serve(
      c,
      s,
      entry.thumbnail_key,
      contentTypeOf(extname(entry.thumbnail_key).slice(1)),
      null,
    );
  });

  app.openapi(previewRoute, async (c) => {
    const s = needStore(store);
    const viewer = { userId: currentPrincipal(c).userId };
    const entry = await visibleEntry(db, viewer, c.req.valid("param").id);
    if (entry.preview_key === null) throw new ApiError("not_found", "no preview yet");
    return serve(c, s, entry.preview_key, "video/mp4", null);
  });
}
