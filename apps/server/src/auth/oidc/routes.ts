import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Kysely } from "kysely";
import * as client from "openid-client";
import type { Logger } from "pino";
import type { Database } from "../../db/schema.ts";
import type { AuthConfig } from "../config.ts";
import { setAuthCookies } from "../cookies.ts";
import { newSecret } from "../secrets.ts";
import { createSession } from "../sessions.ts";
import { forgetGrant, groupsFrom, roleFor, saveGrant, upsertOidcUser } from "./accounts.ts";
import { PENDING_TTL_SECONDS, safeReturnTo, savePending, takePending } from "./pending.ts";
import type { OidcProvider } from "./provider.ts";

const BINDING_COOKIE = "uroboros_oidc";
const BINDING_PATH = "/api/auth/oidc";

type AuthError = "expired" | "cancelled" | "unavailable" | "failed" | "disabled" | "unregistered";

const loginRoute = createRoute({
  method: "get",
  path: "/api/auth/oidc/login",
  security: [],
  tags: ["auth"],
  summary: "Start signing in with the OIDC provider (redirects to it)",
  request: { query: z.object({ returnTo: z.string().max(2048).optional() }) },
  responses: { 303: { description: "To the provider, or back with ?auth_error=unavailable" } },
});

const callbackRoute = createRoute({
  method: "get",
  path: "/api/auth/oidc/callback",
  security: [],
  tags: ["auth"],
  summary: "The provider's redirect back after sign-in",
  request: {
    query: z.object({
      code: z.string().max(4096).optional(),
      state: z.string().max(512).optional(),
      error: z.string().max(256).optional(),
    }),
  },
  responses: { 303: { description: "Into the app, or back with ?auth_error=…" } },
});

export interface OidcRoutesContext {
  db: Kysely<Database>;
  provider: OidcProvider;
  settings: AuthConfig;
  secureCookies: boolean;
  logger: Logger;
}

const fail = (c: Context, why: AuthError) => c.redirect(`/?auth_error=${why}`, 303);

async function finish(
  c: Context,
  ctx: OidcRoutesContext,
  config: client.Configuration,
  pending: { nonce: string; verifier: string },
  state: string,
): Promise<{ error: AuthError } | { userId: string }> {
  const callbackUrl = new URL(ctx.provider.settings.redirectUrl);
  callbackUrl.search = new URL(c.req.url).search;
  let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
  try {
    tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: pending.verifier,
      expectedState: state,
      expectedNonce: pending.nonce,
      idTokenExpected: true,
    });
  } catch (err) {
    ctx.logger.warn({ err }, "oidc code exchange or ID token check failed");
    return { error: "failed" };
  }
  const claims = (tokens.claims() ?? {}) as Record<string, unknown> & { iss: string; sub: string };
  const groups = groupsFrom(claims, ctx.provider.settings.groupsClaim);
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const user = await upsertOidcUser(
    ctx.db,
    {
      issuer: claims.iss,
      subject: claims.sub,
      displayName: (str(claims.name) ?? str(claims.preferred_username) ?? claims.sub).slice(0, 128),
      email: str(claims.email),
      groups,
      role: roleFor(groups, ctx.provider.settings.adminGroups),
    },
    { create: ctx.provider.settings.autoCreate },
  );
  if (user === null) {
    ctx.logger.info(
      { issuer: claims.iss, subject: claims.sub },
      "oidc sign-in turned away: no account, and UROBOROS_OIDC_AUTO_CREATE is false",
    );
    return { error: "unregistered" };
  }
  if (user.disabled) return { error: "disabled" };
  // No refresh token this time: an older one must not linger, or the sync would redeem a token the
  // provider may already have dropped and revoke a user who just signed in.
  if (tokens.refresh_token === undefined) await forgetGrant(ctx.db, user.id);
  else await saveGrant(ctx.db, user.id, tokens.refresh_token);
  return { userId: user.id };
}

export function registerOidcRoutes(app: OpenAPIHono, ctx: OidcRoutesContext): void {
  app.openapi(loginRoute, async (c) => {
    const config = ctx.provider.configuration();
    if (config === null) return fail(c, "unavailable");
    const pending = {
      state: client.randomState(),
      binding: newSecret(),
      nonce: client.randomNonce(),
      verifier: client.randomPKCECodeVerifier(),
      returnTo: safeReturnTo(c.req.valid("query").returnTo),
    };
    await savePending(ctx.db, pending);
    setCookie(c, BINDING_COOKIE, pending.binding, {
      path: BINDING_PATH,
      httpOnly: true,
      sameSite: "Lax",
      secure: ctx.secureCookies,
      maxAge: PENDING_TTL_SECONDS,
    });
    const scope = ["openid", "profile", "email"];
    if (ctx.provider.settings.syncIntervalSecs > 0) scope.push("offline_access");
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: ctx.provider.settings.redirectUrl,
      scope: scope.join(" "),
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: await client.calculatePKCECodeChallenge(pending.verifier),
      code_challenge_method: "S256",
    });
    return c.redirect(url.href, 303);
  });

  app.openapi(callbackRoute, async (c) => {
    const { state, error } = c.req.valid("query");
    const binding = getCookie(c, BINDING_COOKIE) ?? "";
    deleteCookie(c, BINDING_COOKIE, { path: BINDING_PATH, secure: ctx.secureCookies });
    if (state === undefined) return fail(c, "failed");
    const pending = await takePending(ctx.db, state, binding);
    if (pending === null) return fail(c, "expired");
    if (pending === "binding") return fail(c, "failed");
    if (error !== undefined) return fail(c, error === "access_denied" ? "cancelled" : "failed");
    const config = ctx.provider.configuration();
    if (config === null) return fail(c, "unavailable");
    const outcome = await finish(c, ctx, config, pending, state);
    if ("error" in outcome) return fail(c, outcome.error);
    const session = await createSession(ctx.db, {
      userId: outcome.userId,
      ttlHours: ctx.settings.sessionTtlHours,
      userAgent: c.req.header("user-agent") ?? null,
    });
    setAuthCookies(c, {
      token: session.token,
      csrf: session.csrf,
      maxAgeSeconds: ctx.settings.sessionTtlHours * 3600,
      secure: ctx.secureCookies,
    });
    return c.redirect(pending.returnTo, 303);
  });
}

/** The provider's end-session URL for an SSO user (RP-initiated logout); null otherwise. */
export async function oidcEndSessionUrl(
  db: Kysely<Database>,
  provider: OidcProvider,
  publicBaseUrl: string,
  userId: string,
): Promise<string | null> {
  const config = provider.configuration();
  if (config?.serverMetadata().end_session_endpoint === undefined) return null;
  const row = await db
    .selectFrom("users")
    .select("oidc_subject")
    .where("id", "=", userId)
    .executeTakeFirst();
  if (row?.oidc_subject == null) return null;
  return client
    .buildEndSessionUrl(config, {
      client_id: provider.settings.clientId,
      post_logout_redirect_uri: `${publicBaseUrl}/`,
    })
    .toString();
}
