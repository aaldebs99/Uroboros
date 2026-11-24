import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { JobQueue } from "../jobs/queues.ts";
import {
  ApiErrorBody,
  Directory,
  LibraryPage,
  LibrarySort,
  PeopleShareBody,
  PlaylistDetail,
  PublicLinkBody,
  SharedDetail,
  SharedWithMe,
  ShareKind,
  ShareState,
} from "@uroboros/contract";
import type { Context } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import { currentPrincipal } from "../api/principal.ts";
import { listDirectory } from "./directory.ts";
import { listMyShares, setLink, setPeople, shareState, stopSharing } from "./manage.ts";
import { noticeShared, sharedNotice } from "./notices.ts";
import { listSharedWithMe, saveShared, sharedDetail, sharedEntries } from "./shared.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const target = z.object({
  kind: ShareKind.openapi({ param: { name: "kind", in: "path" } }),
  id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
});
const shareParams = z.object({
  shareId: z.uuid().openapi({ param: { name: "shareId", in: "path" } }),
});
const tags = ["sharing"];
const notYours = error("Not one of the caller's things");

const mineRoute = createRoute({
  method: "get",
  path: "/api/shares",
  tags,
  summary: "Everything the caller shares, one row per thing, latest change first",
  responses: { 200: json(z.array(ShareState), "Shares") },
});

const stateRoute = createRoute({
  method: "get",
  path: "/api/shares/{kind}/{id}",
  tags,
  summary: "How one of the caller's videos or playlists is shared",
  request: { params: target },
  responses: { 200: json(ShareState, "Its sharing"), 404: notYours },
});

const peopleRoute = createRoute({
  method: "put",
  path: "/api/shares/{kind}/{id}/people",
  tags,
  summary: "Share with these people and groups (an empty list stops sharing with people)",
  request: { params: target, ...body(PeopleShareBody) },
  responses: {
    200: json(ShareState, "Its sharing"),
    400: error("Yourself, or no such user"),
    404: notYours,
  },
});

const stopPeopleRoute = createRoute({
  method: "delete",
  path: "/api/shares/{kind}/{id}/people",
  tags,
  summary: "Stop sharing with people",
  request: { params: target },
  responses: { 204: { description: "Stopped" }, 404: notYours },
});

const linkRoute = createRoute({
  method: "put",
  path: "/api/shares/{kind}/{id}/link",
  tags,
  summary: "Turn the public link on (a new code) or change it (the same code)",
  request: { params: target, ...body(PublicLinkBody) },
  responses: { 200: json(ShareState, "Its sharing"), 404: notYours },
});

const stopLinkRoute = createRoute({
  method: "delete",
  path: "/api/shares/{kind}/{id}/link",
  tags,
  summary: "Turn the public link off; its code never works again",
  request: { params: target },
  responses: { 204: { description: "Stopped" }, 404: notYours },
});

const withMeRoute = createRoute({
  method: "get",
  path: "/api/shared",
  tags,
  summary: "What other people share with the caller, newest first",
  responses: { 200: json(z.array(SharedWithMe), "Shares") },
});

const sharedRoute = createRoute({
  method: "get",
  path: "/api/shared/{shareId}",
  tags,
  summary: "One thing shared with the caller",
  request: { params: shareParams },
  responses: { 200: json(SharedDetail, "The share"), 404: error("Not shared with the caller") },
});

const sharedEntriesRoute = createRoute({
  method: "get",
  path: "/api/shared/{shareId}/entries",
  tags,
  summary: "A page of what a share holds, in order, with the caller's progress",
  request: {
    params: shareParams,
    query: z.object({
      cursor: z
        .string()
        .max(2000)
        .optional()
        .openapi({ param: { name: "cursor", in: "query" } }),
      sort: LibrarySort.optional().openapi({ param: { name: "sort", in: "query" } }),
    }),
  },
  responses: {
    200: json(LibraryPage, "A page"),
    400: error("A bad cursor or sort"),
    404: error("Not shared with the caller"),
  },
});

const saveRoute = createRoute({
  method: "post",
  path: "/api/shared/{shareId}/save",
  tags,
  summary:
    "Save as my playlist: a shared playlist's videos into the caller's library, as their own playlist",
  request: { params: shareParams },
  responses: {
    201: json(PlaylistDetail, "The caller's new playlist"),
    404: error("Not shared with the caller"),
    409: error("A single video (use Add to my library)"),
  },
});

const directoryRoute = createRoute({
  method: "get",
  path: "/api/directory",
  tags,
  summary: "Who the caller can share with: the other accounts and the groups in use",
  responses: { 200: json(Directory, "The directory") },
});

const me = (c: Context) => currentPrincipal(c).userId;

/**
 * Sharing with people and by link, and what is shared with the caller (docs/sharing.md). With
 * the `notify` queue, people a share newly reaches hear about it.
 */
export function registerSharingRoutes(
  app: OpenAPIHono,
  db: Kysely<Database>,
  notify?: JobQueue<NotifyJob>,
): void {
  app.openapi(mineRoute, async (c) => c.json(await listMyShares(db, me(c)), 200));
  app.openapi(stateRoute, async (c) => {
    const t = c.req.valid("param");
    return c.json(await shareState(db, me(c), t.kind, t.id), 200);
  });
  app.openapi(peopleRoute, async (c) => {
    const t = c.req.valid("param");
    const result = await setPeople(db, me(c), t.kind, t.id, c.req.valid("json"));
    if (notify !== undefined && result.shareId !== null && result.newlyReached.length > 0) {
      const owner = await db
        .selectFrom("users")
        .select("display_name")
        .where("id", "=", me(c))
        .executeTakeFirstOrThrow();
      const message = sharedNotice(owner.display_name, result.state.title, {
        kind: t.kind,
        id: t.id,
        shareId: result.shareId,
      });
      await noticeShared(db, notify, result.newlyReached, message);
    }
    return c.json(result.state, 200);
  });
  app.openapi(stopPeopleRoute, async (c) => {
    const t = c.req.valid("param");
    await stopSharing(db, me(c), t.kind, t.id, "people");
    return c.body(null, 204);
  });
  app.openapi(linkRoute, async (c) => {
    const t = c.req.valid("param");
    return c.json(await setLink(db, me(c), t.kind, t.id, c.req.valid("json")), 200);
  });
  app.openapi(stopLinkRoute, async (c) => {
    const t = c.req.valid("param");
    await stopSharing(db, me(c), t.kind, t.id, "link");
    return c.body(null, 204);
  });
  app.openapi(withMeRoute, async (c) => c.json(await listSharedWithMe(db, me(c)), 200));
  app.openapi(sharedRoute, async (c) =>
    c.json(await sharedDetail(db, me(c), c.req.valid("param").shareId), 200),
  );
  app.openapi(sharedEntriesRoute, async (c) =>
    c.json(await sharedEntries(db, me(c), c.req.valid("param").shareId, c.req.valid("query")), 200),
  );
  app.openapi(saveRoute, async (c) =>
    c.json(await saveShared(db, me(c), c.req.valid("param").shareId), 201),
  );
  app.openapi(directoryRoute, async (c) => c.json(await listDirectory(db, me(c)), 200));
}
