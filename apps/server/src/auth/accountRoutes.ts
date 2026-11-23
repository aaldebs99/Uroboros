import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorBody, ChangePasswordBody, SessionView } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";
import { deleteOtherSessions, listSessions, sessionIdOf } from "./sessions.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);

const passwordRoute = createRoute({
  method: "post",
  path: "/api/me/password",
  tags: ["account"],
  summary: "Change the caller's password (local accounts); signs out the other sessions",
  request: {
    body: { required: true, content: { "application/json": { schema: ChangePasswordBody } } },
  },
  responses: {
    204: { description: "Changed" },
    403: error("The current password is wrong (403, not 401: the session itself is fine)"),
    409: error("An SSO account has no password here"),
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/api/me/sessions",
  tags: ["account"],
  summary: "The caller's signed-in browsers",
  responses: { 200: json(z.array(SessionView), "Sessions") },
});

const deleteOneRoute = createRoute({
  method: "delete",
  path: "/api/me/sessions/{id}",
  tags: ["account"],
  summary: "Sign out one of the caller's sessions",
  request: {
    params: z.object({
      id: z
        .string()
        .regex(/^[0-9a-f]{16}$/)
        .openapi({ param: { name: "id", in: "path" } }),
    }),
  },
  responses: { 204: { description: "Signed out" }, 404: error("No such session") },
});

const deleteOthersRoute = createRoute({
  method: "delete",
  path: "/api/me/sessions",
  tags: ["account"],
  summary: "Sign out everywhere except this browser",
  responses: { 204: { description: "Signed out elsewhere" } },
});

export function registerAccountRoutes(app: OpenAPIHono, db: Kysely<Database>): void {
  app.openapi(passwordRoute, async (c) => {
    const principal = currentPrincipal(c);
    const body = c.req.valid("json");
    const row = await db
      .selectFrom("users")
      .select("password_hash")
      .where("id", "=", principal.userId)
      .executeTakeFirstOrThrow();
    if (row.password_hash === null) {
      throw new ApiError("conflict", "an SSO account changes its password at the provider");
    }
    if (!(await verifyPassword(row.password_hash, body.currentPassword))) {
      throw new ApiError("forbidden", "the current password is wrong");
    }
    await db
      .updateTable("users")
      .set({ password_hash: await hashPassword(body.newPassword) })
      .where("id", "=", principal.userId)
      .execute();
    await deleteOtherSessions(db, principal.userId, principal.sessionHash ?? null);
    return c.body(null, 204);
  });

  app.openapi(listRoute, async (c) => {
    const principal = currentPrincipal(c);
    const current = principal.sessionHash === undefined ? null : sessionIdOf(principal.sessionHash);
    const sessions = await listSessions(db, principal.userId);
    return c.json(
      sessions.map((s) => ({
        id: s.id,
        current: s.id === current,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
      })),
      200,
    );
  });

  app.openapi(deleteOneRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const id = c.req.valid("param").id;
    const target = (await listSessions(db, userId)).find((s) => s.id === id);
    if (target === undefined) throw new ApiError("not_found", "no such session");
    await db.deleteFrom("auth_sessions").where("token_hash", "=", target.tokenHash).execute();
    return c.body(null, 204);
  });

  app.openapi(deleteOthersRoute, async (c) => {
    const principal = currentPrincipal(c);
    await deleteOtherSessions(db, principal.userId, principal.sessionHash ?? null);
    return c.body(null, 204);
  });
}
