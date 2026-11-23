import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  AdminUser,
  AdminUserPatch,
  ApiErrorBody,
  NewLocalUserBody,
  ResetPasswordBody,
  type AdminUser as AdminUserT,
} from "@uroboros/contract";
import type { Kysely, Selectable } from "kysely";
import type { Logger } from "pino";
import type { Database, UsersTable } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { runSyncPass } from "./claimsSync.ts";
import { requireAdmin } from "./guard.ts";
import type { OidcProvider } from "./oidc/provider.ts";
import { hashPassword } from "./passwords.ts";
import { deleteOtherSessions } from "./sessions.ts";

const UNIQUE_VIOLATION = "23505";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const idParams = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" }, description: "User id" }),
});

const syncRoute = createRoute({
  method: "post",
  path: "/api/admin/users/oidc-sync",
  tags: ["admin"],
  summary: "Refresh every SSO user's groups and role from the provider now",
  responses: {
    204: { description: "Pass finished (or OIDC is not set up)" },
    403: error("Admins only"),
    409: error("A pass is already running"),
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/api/admin/users",
  tags: ["admin"],
  summary: "Every user",
  responses: { 200: json(z.array(AdminUser), "Users"), 403: error("Admins only") },
});

const createUserRoute = createRoute({
  method: "post",
  path: "/api/admin/users",
  tags: ["admin"],
  summary: "Create a local account",
  request: body(NewLocalUserBody),
  responses: { 200: json(AdminUser, "The user"), 409: error("The username is taken") },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/api/admin/users/{id}",
  tags: ["admin"],
  summary: "Change a user's role, name, or disable or enable them",
  request: { params: idParams, ...body(AdminUserPatch) },
  responses: {
    200: json(AdminUser, "The user"),
    404: error("No such user"),
    409: error("Not allowed for this user (SSO, yourself or the bootstrap admin)"),
  },
});

const resetRoute = createRoute({
  method: "post",
  path: "/api/admin/users/{id}/password",
  tags: ["admin"],
  summary: "Set a local user's password; signs them out everywhere",
  request: { params: idParams, ...body(ResetPasswordBody) },
  responses: {
    204: { description: "Set" },
    404: error("No such user"),
    409: error("Not a local account"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/admin/users/{id}",
  tags: ["admin"],
  summary: "Delete a local account",
  request: { params: idParams },
  responses: {
    204: { description: "Deleted" },
    404: error("No such user"),
    409: error("Not allowed for this user"),
  },
});

export interface AdminUserRoutesContext {
  db: Kysely<Database>;
  provider: OidcProvider;
  databaseUrl: string;
  logger: Logger;
}

type UserRow = Selectable<UsersTable>;

function view(u: UserRow): AdminUserT {
  return {
    id: u.id,
    displayName: u.display_name,
    username: u.username,
    email: u.email,
    role: u.role,
    method: u.oidc_subject === null ? "local" : "oidc",
    disabled: u.disabled_at !== null,
    revoked: u.revoked_at !== null,
    isBootstrap: u.bootstrap,
    lastLoginAt: u.last_login_at?.toISOString() ?? null,
    claimsSyncedAt: u.claims_synced_at?.toISOString() ?? null,
  };
}

async function findUser(db: Kysely<Database>, id: string): Promise<UserRow> {
  const row = await db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
  if (row === undefined) throw new ApiError("not_found", "no such user");
  return row;
}

/** Throws a 409 explaining why `patch` may not be applied to `target`. */
function checkPatch(target: UserRow, patch: AdminUserPatch, selfId: string): void {
  const sso = target.oidc_subject !== null;
  if (patch.role !== undefined && patch.role !== target.role) {
    if (sso) throw new ApiError("conflict", "role comes from Authentik groups");
    if (target.id === selfId) throw new ApiError("conflict", "you cannot change your own role");
  }
  if (patch.displayName !== undefined && sso) {
    throw new ApiError("conflict", "an SSO user's name comes from the provider");
  }
  if (patch.disabled === true) {
    if (target.id === selfId) throw new ApiError("conflict", "you cannot disable yourself");
    if (target.bootstrap) throw new ApiError("conflict", "the bootstrap admin cannot be disabled");
  }
}

export function registerAdminUserRoutes(app: OpenAPIHono, ctx: AdminUserRoutesContext): void {
  const { db } = ctx;

  app.openapi(syncRoute, async (c) => {
    requireAdmin(currentPrincipal(c));
    const outcome = await runSyncPass(ctx, { force: true });
    if (outcome === "busy") throw new ApiError("conflict", "a sync pass is already running");
    return c.body(null, 204);
  });

  app.openapi(listRoute, async (c) => {
    requireAdmin(currentPrincipal(c));
    const rows = await db.selectFrom("users").selectAll().orderBy("display_name").execute();
    return c.json(rows.map(view), 200);
  });

  app.openapi(createUserRoute, async (c) => {
    requireAdmin(currentPrincipal(c));
    const b = c.req.valid("json");
    try {
      const row = await db
        .insertInto("users")
        .values({
          username: b.username,
          display_name: b.displayName,
          role: b.role,
          password_hash: await hashPassword(b.password),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return c.json(view(row), 200);
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ApiError("conflict", "that username is taken");
      }
      throw err;
    }
  });

  app.openapi(patchRoute, async (c) => {
    const principal = currentPrincipal(c);
    requireAdmin(principal);
    const target = await findUser(db, c.req.valid("param").id);
    const patch = c.req.valid("json");
    checkPatch(target, patch, principal.userId);
    const row = await db
      .updateTable("users")
      .set({
        ...(patch.role === undefined ? {} : { role: patch.role }),
        ...(patch.displayName === undefined ? {} : { display_name: patch.displayName }),
        ...(patch.disabled === undefined
          ? {}
          : { disabled_at: patch.disabled ? (target.disabled_at ?? new Date()) : null }),
      })
      .where("id", "=", target.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return c.json(view(row), 200);
  });

  app.openapi(resetRoute, async (c) => {
    requireAdmin(currentPrincipal(c));
    const target = await findUser(db, c.req.valid("param").id);
    if (target.username === null) throw new ApiError("conflict", "not a local account");
    await db
      .updateTable("users")
      .set({ password_hash: await hashPassword(c.req.valid("json").password) })
      .where("id", "=", target.id)
      .execute();
    await deleteOtherSessions(db, target.id, null);
    return c.body(null, 204);
  });

  app.openapi(deleteRoute, async (c) => {
    const principal = currentPrincipal(c);
    requireAdmin(principal);
    const target = await findUser(db, c.req.valid("param").id);
    if (target.oidc_subject !== null) {
      throw new ApiError(
        "conflict",
        "disable SSO accounts instead; they come back on next sign-in",
      );
    }
    if (target.id === principal.userId)
      throw new ApiError("conflict", "you cannot delete yourself");
    if (target.bootstrap) throw new ApiError("conflict", "the bootstrap admin cannot be deleted");
    await db.deleteFrom("users").where("id", "=", target.id).execute();
    return c.body(null, 204);
  });
}
