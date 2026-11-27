import { extname } from "node:path";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorBody, type PublicShare } from "@uroboros/contract";
import type { Context } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { needStore, serve } from "../downloads/libraryRoutes.ts";
import { clipOf, clipTitle, copyFilename } from "../exports/clip.ts";
import { contentTypeOf } from "../storage/contentType.ts";
import type { MediaStore } from "../storage/index.ts";
import { clipLinkShare, visibleClip, type VisibleClip } from "./clipAccess.ts";
import { clipItem } from "./clipView.ts";
import { DEAD } from "./public.ts";

/**
 * A clip's public link (docs/sharing.md#clips): `/api/public/s/{code}` answers the clip, and its
 * file streams, saves (when the link allows downloads) and has a thumbnail under
 * `/api/public/s/{code}/clip`. Nothing else of the video it was cut from is reachable by its code.
 */

type Db = Kysely<Database>;

const base = (code: string) => `/api/public/s/${code}/clip`;

/** The clip a live link's code reaches, or null for none (or while clips are off). */
async function linkedClip(db: Db, code: string, clips: boolean): Promise<VisibleClip | null> {
  if (!clips) return null;
  const share = await clipLinkShare(db, code);
  if (share === undefined) return null;
  return visibleClip(db, { code }, share.exportId).catch(() => null);
}

/** What a clip's public link shows, or null when the code is no clip's. */
export async function publicClip(
  db: Db,
  code: string,
  clips: boolean,
): Promise<PublicShare | null> {
  const row = await linkedClip(db, code, clips);
  const range = row === null ? null : clipOf(row);
  if (row === null || range === null) return null;
  return {
    kind: "clip",
    title: clipTitle(row.title ?? row.video_id, range),
    description: null,
    allowDownload: row.allow_download,
    items: [],
    clip: clipItem(row, base(code)),
  };
}

const dead = {
  description: "The link doesn't work any more",
  content: { "application/json": { schema: ApiErrorBody } },
};
const binary = (description: string) => ({
  description,
  content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
});
const params = z.object({
  code: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .openapi({ param: { name: "code", in: "path" } }),
});
const open = { tags: ["public links"], security: [] as [] };
const fileResponses = {
  200: binary("The clip"),
  206: binary("A byte range of it"),
  302: { description: "A presigned URL" },
  404: dead,
  416: { description: "The range is past the end" },
};

const streamRoute = createRoute({
  ...open,
  method: "get",
  path: "/api/public/s/{code}/clip/stream",
  summary: "A clip link's file inline, for the player",
  request: { params },
  responses: fileResponses,
});
const fileRoute = createRoute({
  ...open,
  method: "get",
  path: "/api/public/s/{code}/clip/file",
  summary: "Save a clip link's file, when the link allows downloads",
  request: { params },
  responses: fileResponses,
});
const thumbnailRoute = createRoute({
  ...open,
  method: "get",
  path: "/api/public/s/{code}/clip/thumbnail",
  summary: "A clip link's thumbnail: its video's",
  request: { params },
  responses: { 200: binary("The image"), 404: dead },
});

/** Serves a clip's made file, inline or (`filename`) to save; 404 until it is made. */
export async function clipFile(c: Context, store: MediaStore, row: VisibleClip, save: boolean) {
  if (row.state !== "done" || row.storage_key === null) {
    throw new ApiError("not_found", "the clip is not made yet");
  }
  const filename = copyFilename(row);
  const url = await store.downloadUrl(row.storage_key, filename);
  if (url !== null) return c.redirect(url, 302);
  return serve(c, store, row.storage_key, contentTypeOf(row.format), save ? filename : null);
}

/** Serves a clip's thumbnail (its video's); 404 for none. */
export async function clipThumbnail(c: Context, store: MediaStore, row: VisibleClip) {
  if (row.thumbnail_key === null) throw new ApiError("not_found", "no thumbnail");
  return serve(
    c,
    store,
    row.thumbnail_key,
    contentTypeOf(extname(row.thumbnail_key).slice(1)),
    null,
  );
}

export function registerClipPublicRoutes(
  app: OpenAPIHono,
  db: Db,
  store: MediaStore | undefined,
  clips: boolean,
): void {
  const clipOfLink = async (code: string) => {
    const row = await linkedClip(db, code, clips);
    if (row === null) throw new ApiError("not_found", DEAD);
    return row;
  };
  app.openapi(streamRoute, async (c) =>
    clipFile(c, needStore(store), await clipOfLink(c.req.valid("param").code), false),
  );
  app.openapi(fileRoute, async (c) => {
    const row = await clipOfLink(c.req.valid("param").code);
    if (!row.allow_download) throw new ApiError("not_found", "this link does not offer downloads");
    return clipFile(c, needStore(store), row, true);
  });
  app.openapi(thumbnailRoute, async (c) =>
    clipThumbnail(c, needStore(store), await clipOfLink(c.req.valid("param").code)),
  );
}
