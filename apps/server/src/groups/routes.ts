import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  AdminGroup,
  ApiErrorBody,
  GroupDetail,
  GroupMembersBody,
  GroupNameBody,
  GroupRoleBody,
  GroupShare,
  GroupSummary,
  NewGroupBody,
} from "@uroboros/contract";
import type { Context } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import type { JobQueue } from "../jobs/queues.ts";
import { currentPrincipal } from "../api/principal.ts";
import { requireAdmin } from "../auth/guard.ts";
import { addedNotice, noticeAdded } from "./notices.ts";
import {
  addMembers,
  adminDeleteGroup,
  createGroup,
  deleteGroup,
  groupDetail,
  groupShares,
  listAllGroups,
  listGroups,
  removeMember,
  renameGroup,
  setRole,
} from "./store.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const groupParams = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
});
const memberParams = groupParams.extend({
  userId: z.uuid().openapi({ param: { name: "userId", in: "path" } }),
});
const tags = ["groups"];
const notIn = error("No such group, or the caller isn't in it");
const notManager = error("The caller isn't one of the group's managers");
const detail = json(GroupDetail, "The group");

const listRoute = createRoute({
  method: "get",
  path: "/api/groups",
  tags,
  summary: "The caller's groups, by name",
  responses: { 200: json(z.array(GroupSummary), "Groups") },
});

const createGroupRoute = createRoute({
  method: "post",
  path: "/api/groups",
  tags,
  summary: "Make a group, with the caller as its manager",
  request: body(NewGroupBody),
  responses: {
    201: json(GroupDetail, "The new group"),
    409: error("The caller has made the most groups they may (and is still in)"),
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/api/groups/{id}",
  tags,
  summary: "One of the caller's groups, with everyone in it",
  request: { params: groupParams },
  responses: { 200: detail, 404: notIn },
});

const renameRoute = createRoute({
  method: "patch",
  path: "/api/groups/{id}",
  tags,
  summary: "Rename a group (managers)",
  request: { params: groupParams, ...body(GroupNameBody) },
  responses: { 200: detail, 403: notManager, 404: notIn },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/groups/{id}",
  tags,
  summary: "Delete a group (managers); what was shared only with it stops being shared",
  request: { params: groupParams },
  responses: { 204: { description: "Deleted" }, 403: notManager, 404: notIn },
});

const addRoute = createRoute({
  method: "post",
  path: "/api/groups/{id}/members",
  tags,
  summary: "Add people to a group (managers); they join at once, and anyone already in is skipped",
  request: { params: groupParams, ...body(GroupMembersBody) },
  responses: {
    200: detail,
    400: error("An unknown or disabled account"),
    403: notManager,
    404: notIn,
    409: error("The group would hold more people than it may"),
  },
});

const roleRoute = createRoute({
  method: "patch",
  path: "/api/groups/{id}/members/{userId}",
  tags,
  summary: "Make a member a manager, or a manager a member (managers)",
  request: { params: memberParams, ...body(GroupRoleBody) },
  responses: {
    200: detail,
    400: error("A disabled account can't be a manager"),
    403: notManager,
    404: notIn,
    409: error("The group's last enabled manager can't step down"),
  },
});

const removeRoute = createRoute({
  method: "delete",
  path: "/api/groups/{id}/members/{userId}",
  tags,
  summary: "Leave a group (your own id), or take someone out of it (managers)",
  request: { params: memberParams },
  responses: {
    204: { description: "Out of the group" },
    403: notManager,
    404: notIn,
    409: error("The group's last enabled manager can't leave while others remain"),
  },
});

const sharesRoute = createRoute({
  method: "get",
  path: "/api/groups/{id}/shares",
  tags,
  summary: "What the group's members share with it, newest change first",
  request: { params: groupParams },
  responses: { 200: json(z.array(GroupShare), "Shared with the group"), 404: notIn },
});

const adminListRoute = createRoute({
  method: "get",
  path: "/api/admin/groups",
  tags: ["admin"],
  summary: "Every group (admins)",
  responses: { 200: json(z.array(AdminGroup), "Groups"), 403: error("Not an admin") },
});

const adminDeleteRoute = createRoute({
  method: "delete",
  path: "/api/admin/groups/{id}",
  tags: ["admin"],
  summary: "Delete any group (admins)",
  request: { params: groupParams },
  responses: {
    204: { description: "Deleted" },
    403: error("Not an admin"),
    404: error("No such group"),
  },
});

const me = (c: Context) => currentPrincipal(c).userId;

/**
 * Groups people make and run (docs/sharing.md "Groups"). With the `notify` queue, people added to
 * a group hear about it.
 */
export function registerGroupRoutes(
  app: OpenAPIHono,
  db: Kysely<Database>,
  notify?: JobQueue<NotifyJob>,
  clipsEnabled = true,
): void {
  app.openapi(listRoute, async (c) => c.json(await listGroups(db, me(c)), 200));
  app.openapi(createGroupRoute, async (c) =>
    c.json(await createGroup(db, me(c), c.req.valid("json").name), 201),
  );
  app.openapi(getRoute, async (c) =>
    c.json(await groupDetail(db, me(c), c.req.valid("param").id), 200),
  );
  app.openapi(renameRoute, async (c) =>
    c.json(await renameGroup(db, me(c), c.req.valid("param").id, c.req.valid("json").name), 200),
  );
  app.openapi(deleteRoute, async (c) => {
    await deleteGroup(db, me(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
  app.openapi(addRoute, async (c) => {
    const { id } = c.req.valid("param");
    const result = await addMembers(db, me(c), id, c.req.valid("json").userIds);
    if (notify !== undefined && result.added.length > 0) {
      const actor = await db
        .selectFrom("users")
        .select("display_name")
        .where("id", "=", me(c))
        .executeTakeFirstOrThrow();
      const message = addedNotice(actor.display_name, { id, name: result.name });
      await noticeAdded(db, notify, result.added, message);
    }
    return c.json(result.detail, 200);
  });
  app.openapi(roleRoute, async (c) => {
    const p = c.req.valid("param");
    return c.json(await setRole(db, me(c), p.id, p.userId, c.req.valid("json").role), 200);
  });
  app.openapi(removeRoute, async (c) => {
    const p = c.req.valid("param");
    await removeMember(db, me(c), p.id, p.userId);
    return c.body(null, 204);
  });
  app.openapi(sharesRoute, async (c) =>
    c.json(await groupShares(db, me(c), c.req.valid("param").id, clipsEnabled), 200),
  );
  app.openapi(adminListRoute, async (c) => {
    requireAdmin(currentPrincipal(c));
    return c.json(await listAllGroups(db), 200);
  });
  app.openapi(adminDeleteRoute, async (c) => {
    requireAdmin(currentPrincipal(c));
    await adminDeleteGroup(db, c.req.valid("param").id);
    return c.body(null, 204);
  });
}
