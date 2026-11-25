import { createRoute, type OpenAPIHono, type z } from "@hono/zod-openapi";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  ApiErrorBody,
  AuthMethods,
  LocalLoginBody,
  LogoutResult,
  Me,
  type AuthMethods as AuthMethodsT,
} from "@uroboros/contract";
import type { Context } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import type { AuthConfig } from "./config.ts";
import { clearAuthCookies, secureCookiesFor, setAuthCookies } from "./cookies.ts";
import { failureKeys, type Limiter } from "./limiter.ts";
import { DUMMY_HASH, verifyPassword } from "./passwords.ts";
import { createSession, deleteSession } from "./sessions.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);

const methodsRoute = createRoute({
  method: "get",
  path: "/api/auth/methods",
  security: [],
  tags: ["auth"],
  summary: "The sign-in methods this server offers",
  responses: { 200: json(AuthMethods, "Sign-in methods") },
});

const loginRoute = createRoute({
  method: "post",
  path: "/api/auth/local/login",
  security: [],
  tags: ["auth"],
  summary: "Sign in with a local username and password",
  request: {
    body: { required: true, content: { "application/json": { schema: LocalLoginBody } } },
  },
  responses: {
    204: { description: "Signed in; the session and CSRF cookies are set" },
    401: error("Wrong username or password"),
    403: error("The account is disabled"),
    404: error("Local sign-in is turned off"),
    429: error("Too many failed attempts; try again later"),
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/api/auth/logout",
  tags: ["auth"],
  summary: "Sign out of this browser",
  responses: {
    200: json(LogoutResult, "Signed out; where to send the browser next"),
    400: error("Signed in with an API token, which has no session"),
    401: error("Not signed in"),
  },
});

const meRoute = createRoute({
  method: "get",
  path: "/api/me",
  tags: ["auth"],
  summary: "The signed-in user",
  responses: { 200: json(Me, "The caller"), 401: error("Not signed in") },
});

export interface SessionRoutesContext {
  db: Kysely<Database>;
  settings: AuthConfig;
  limiter: Limiter;
  secureCookies: boolean;
  /** The OIDC button's state; null without OIDC. */
  oidcMethod: () => AuthMethodsT["oidc"];
  /** The provider's end-session URL for an SSO user signing out; null otherwise. */
  endSessionUrl: (userId: string) => Promise<string | null>;
}

const secureFor = (c: Context, ctx: SessionRoutesContext) =>
  secureCookiesFor(c, { configured: ctx.secureCookies, trustProxy: ctx.settings.trustProxy });

/**
 * The client address for the per-IP limit. Behind a trusted proxy it is `X-Forwarded-For`'s last
 * entry, the one that proxy added: entries to its left came from the client, and a proxy that
 * appends rather than replaces passes them through unchecked.
 */
function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded !== undefined && forwarded !== "") return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function signIn(
  c: Context,
  ctx: SessionRoutesContext,
  body: LocalLoginBody,
): Promise<string> {
  const username = body.username.trim().toLowerCase();
  const keys = failureKeys(username, clientIp(c, ctx.settings.trustProxy));
  if (await ctx.limiter.attempt(keys)) {
    throw new ApiError("too_many_requests", "too many failed sign-ins; try again in a few minutes");
  }
  const user = await ctx.db
    .selectFrom("users")
    .select(["id", "password_hash", "disabled_at"])
    .where("username", "=", username)
    .where("password_hash", "is not", null)
    .executeTakeFirst();
  const ok = await verifyPassword(user?.password_hash ?? DUMMY_HASH, body.password);
  if (user === undefined || !ok) {
    throw new ApiError("unauthorized", "wrong username or password");
  }
  if (user.disabled_at !== null) throw new ApiError("forbidden", "this account is disabled");
  await ctx.limiter.succeeded(keys);
  return user.id;
}

export function registerSessionRoutes(app: OpenAPIHono, ctx: SessionRoutesContext): void {
  app.openapi(methodsRoute, (c) =>
    c.json({ local: ctx.settings.local.enabled, oidc: ctx.oidcMethod() }, 200),
  );

  app.openapi(loginRoute, async (c) => {
    if (!ctx.settings.local.enabled) throw new ApiError("not_found", "local sign-in is turned off");
    const userId = await signIn(c, ctx, c.req.valid("json"));
    const session = await createSession(ctx.db, {
      userId,
      ttlHours: ctx.settings.sessionTtlHours,
      userAgent: c.req.header("user-agent") ?? null,
    });
    await ctx.db
      .updateTable("users")
      .set({ last_login_at: new Date() })
      .where("id", "=", userId)
      .execute();
    setAuthCookies(c, {
      token: session.token,
      csrf: session.csrf,
      maxAgeSeconds: ctx.settings.sessionTtlHours * 3600,
      secure: secureFor(c, ctx),
    });
    return c.body(null, 204);
  });

  app.openapi(logoutRoute, async (c) => {
    const principal = currentPrincipal(c);
    if (principal.sessionHash === undefined) {
      throw new ApiError("bad_request", "an API token has no session to sign out of");
    }
    await deleteSession(ctx.db, principal.sessionHash);
    clearAuthCookies(c, secureFor(c, ctx));
    return c.json({ endSessionUrl: await ctx.endSessionUrl(principal.userId) }, 200);
  });

  app.openapi(meRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const row = await ctx.db
      .selectFrom("users")
      .select(["id", "display_name", "email", "role", "oidc_subject", "bootstrap"])
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    return c.json(
      {
        id: row.id,
        displayName: row.display_name,
        email: row.email,
        role: row.role,
        method: row.oidc_subject === null ? ("local" as const) : ("oidc" as const),
        isBootstrap: row.bootstrap,
      },
      200,
    );
  });
}
