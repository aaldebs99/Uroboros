import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  NewPlaylistBody,
  PlaylistDetail,
  PlaylistItemsBody,
  PlaylistMoveBody,
  PlaylistPatch,
  PlaylistSummary,
} from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { currentPrincipal } from "../api/principal.ts";
import { getPlaylist, listPlaylists, playlistEntryIds } from "./listing.ts";
import {
  appendItems,
  copyEntries,
  createPlaylist,
  deletePlaylist,
  moveItem,
  removeItem,
  replaceItems,
  updatePlaylist,
} from "./store.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const id = z.uuid().openapi({ param: { name: "id", in: "path" } });
const entryId = z.uuid().openapi({ param: { name: "entryId", in: "path" } });
const done = { description: "Done" };
const youtube = error("A YouTube playlist, which cannot be changed");

const listRoute = createRoute({
  method: "get",
  path: "/api/playlists",
  tags: ["playlists"],
  summary: "The caller's playlists: manual ones first, then YouTube ones holding their videos",
  responses: { 200: json(z.array(PlaylistSummary), "Playlists") },
});

const createPlaylistRoute = createRoute({
  method: "post",
  path: "/api/playlists",
  tags: ["playlists"],
  summary: "Make a manual playlist, optionally with entries of the caller's library",
  request: body(NewPlaylistBody),
  responses: { 201: json(PlaylistDetail, "The playlist"), 400: error("An entry not theirs") },
});

const getRoute = createRoute({
  method: "get",
  path: "/api/playlists/{id}",
  tags: ["playlists"],
  summary:
    "One of the caller's playlists, of either kind (its videos: GET /api/library?playlist= or ?source=)",
  request: { params: z.object({ id }) },
  responses: { 200: json(PlaylistDetail, "The playlist"), 404: error("No such playlist") },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/api/playlists/{id}",
  tags: ["playlists"],
  summary: "Rename or describe a manual playlist",
  request: { params: z.object({ id }), ...body(PlaylistPatch) },
  responses: {
    200: json(PlaylistDetail, "The playlist"),
    404: error("No such playlist"),
    409: youtube,
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/playlists/{id}",
  tags: ["playlists"],
  summary: "Delete a manual playlist (its videos stay in the library)",
  request: { params: z.object({ id }) },
  responses: { 204: done, 404: error("No such playlist"), 409: youtube },
});

const appendRoute = createRoute({
  method: "post",
  path: "/api/playlists/{id}/items",
  tags: ["playlists"],
  summary: "Add entries at the end, skipping ones already in it",
  request: { params: z.object({ id }), ...body(PlaylistItemsBody) },
  responses: {
    204: done,
    400: error("An entry not theirs, a duplicate, or more than the limit"),
    404: error("No such playlist"),
    409: youtube,
  },
});

const replaceRoute = createRoute({
  method: "put",
  path: "/api/playlists/{id}/items",
  tags: ["playlists"],
  summary: "Set the whole order; entries left out leave the playlist",
  request: { params: z.object({ id }), ...body(PlaylistItemsBody) },
  responses: {
    204: done,
    400: error("An entry not theirs, or a duplicate"),
    404: error("No such playlist"),
    409: youtube,
  },
});

const moveRoute = createRoute({
  method: "post",
  path: "/api/playlists/{id}/items/{entryId}/move",
  tags: ["playlists"],
  summary: "Move one entry to a position (0 is first; past the end is last)",
  request: {
    params: z.object({ id, entryId }),
    ...body(PlaylistMoveBody),
  },
  responses: { 204: done, 404: error("No such playlist or entry in it"), 409: youtube },
});

const removeRoute = createRoute({
  method: "delete",
  path: "/api/playlists/{id}/items/{entryId}",
  tags: ["playlists"],
  summary: "Take an entry out of a manual playlist",
  request: { params: z.object({ id, entryId }) },
  responses: { 204: done, 404: error("No such playlist or entry in it"), 409: youtube },
});

const copyRoute = createRoute({
  method: "post",
  path: "/api/playlists/{id}/copy",
  tags: ["playlists"],
  summary:
    "Save as my playlist: a manual copy of the caller's videos from a playlist, in its order",
  request: { params: z.object({ id }) },
  responses: { 201: json(PlaylistDetail, "The new playlist"), 404: error("No such playlist") },
});

/** Manual and YouTube playlists (docs/sharing.md); every route is the caller's own. */
export function registerPlaylistRoutes(app: OpenAPIHono, db: Kysely<Database>): void {
  const me = (c: Parameters<typeof currentPrincipal>[0]) => currentPrincipal(c).userId;
  app.openapi(listRoute, async (c) => c.json(await listPlaylists(db, me(c)), 200));
  app.openapi(createPlaylistRoute, async (c) =>
    c.json(await createPlaylist(db, me(c), c.req.valid("json")), 201),
  );
  app.openapi(getRoute, async (c) =>
    c.json(await getPlaylist(db, me(c), c.req.valid("param").id), 200),
  );
  app.openapi(patchRoute, async (c) =>
    c.json(await updatePlaylist(db, me(c), c.req.valid("param").id, c.req.valid("json")), 200),
  );
  app.openapi(deleteRoute, async (c) => {
    await deletePlaylist(db, me(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
  app.openapi(appendRoute, async (c) => {
    await appendItems(db, me(c), c.req.valid("param").id, c.req.valid("json").entryIds);
    return c.body(null, 204);
  });
  app.openapi(replaceRoute, async (c) => {
    await replaceItems(db, me(c), c.req.valid("param").id, c.req.valid("json").entryIds);
    return c.body(null, 204);
  });
  app.openapi(moveRoute, async (c) => {
    const p = c.req.valid("param");
    await moveItem(db, me(c), p.id, p.entryId, c.req.valid("json").position);
    return c.body(null, 204);
  });
  app.openapi(removeRoute, async (c) => {
    const p = c.req.valid("param");
    await removeItem(db, me(c), p.id, p.entryId);
    return c.body(null, 204);
  });
  app.openapi(copyRoute, async (c) => {
    const userId = me(c);
    const source = await getPlaylist(db, userId, c.req.valid("param").id);
    const ids = await playlistEntryIds(db, userId, { kind: source.kind, id: source.id });
    return c.json(await copyEntries(db, userId, source.name, ids), 201);
  });
}
