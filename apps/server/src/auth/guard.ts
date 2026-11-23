import type { Context, MiddlewareHandler } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { CSRF_HEADER, csrfCookie, sessionCookie } from "./cookies.ts";
import { isSecretShape, safeEqual } from "./secrets.ts";
import { resolveSession } from "./sessions.ts";

export type Role = "admin" | "member";

/** Who a request acts for, set by the guard on every protected `/api` route. */
export interface Principal {
  userId: string;
  role: Role;
  via: "session" | "token";
  /** The session's stored hash, for "this session" in the account routes. */
  sessionHash?: Buffer;
}

declare module "hono" {
  interface ContextVariableMap {
    principal: Principal;
  }
}

/** Looks up an API token's owner; null for an unknown or revoked token. */
export type ResolveToken = (
  db: Kysely<Database>,
  secret: string,
) => Promise<{ userId: string; tokenId: string } | null>;

/** Routes anyone may call. */
const PUBLIC_EXACT = new Set([
  "/api/health",
  "/api/ready",
  "/api/info",
  "/api/openapi.json",
  "/api/auth/methods",
  "/api/auth/local/login",
]);
/** `/api/public/` serves public links (docs/sharing.md), each checking its own code. */
const PUBLIC_PREFIXES = ["/api/docs", "/api/auth/oidc/", "/api/public/"];

/** Routes a token must never reach: it cannot mint a successor, act as admin or move push. */
const TOKEN_REFUSED = [
  "/api/admin",
  "/api/me/tokens",
  "/api/me/password",
  "/api/me/sessions",
  "/api/me/push",
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isPublic(path: string): boolean {
  return (
    PUBLIC_EXACT.has(path) ||
    PUBLIC_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p))
  );
}

export function tokenRefused(path: string): boolean {
  return TOKEN_REFUSED.some((p) => path === p || path.startsWith(`${p}/`));
}

async function activeRole(db: Kysely<Database>, userId: string): Promise<Role | null> {
  const row = await db
    .selectFrom("users")
    .select("role")
    .where("id", "=", userId)
    .where("disabled_at", "is", null)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  return row?.role ?? null;
}

function bearer(header: string | undefined): string | null | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer (\S+)$/.exec(header);
  return match?.[1] ?? null;
}

/**
 * Resolves the caller of every `/api` route outside the public list: the session cookie first,
 * then `Authorization: Bearer`. Cookie writes need the CSRF header; tokens never do.
 */
export function authGuard(deps: {
  db: Kysely<Database>;
  resolveToken: ResolveToken;
}): MiddlewareHandler {
  return async (c, next) => {
    if (isPublic(c.req.path)) {
      await next();
      return;
    }
    const principal = (await fromSession(c, deps.db)) ?? (await fromToken(c, deps));
    c.set("principal", principal);
    await next();
  };
}

/** The session cookie's principal (CSRF-checked for writes), or null when there is no live session. */
async function fromSession(c: Context, db: Kysely<Database>): Promise<Principal | null> {
  const cookie = sessionCookie(c);
  if (cookie === undefined) return null;
  const session = await resolveSession(db, cookie);
  if (session === null) return null;
  if (!SAFE_METHODS.has(c.req.method)) {
    const header = c.req.header(CSRF_HEADER) ?? "";
    const echoed = csrfCookie(c) ?? "";
    if (!safeEqual(header, session.csrf) || !safeEqual(echoed, session.csrf)) {
      throw new ApiError("forbidden", "missing or wrong CSRF token");
    }
  }
  return {
    userId: session.userId,
    role: session.role,
    via: "session",
    sessionHash: session.tokenHash,
  };
}

/** The bearer token's principal; throws 401 without a usable token, 403 on a token-refused route. */
async function fromToken(
  c: Context,
  deps: { db: Kysely<Database>; resolveToken: ResolveToken },
): Promise<Principal> {
  const secret = bearer(c.req.header("authorization"));
  if (secret === undefined || secret === null || !isSecretShape(secret)) {
    throw new ApiError("unauthorized", "sign in required");
  }
  if (tokenRefused(c.req.path)) {
    throw new ApiError("forbidden", "an API token cannot be used here; sign in in the browser");
  }
  const owner = await deps.resolveToken(deps.db, secret);
  const role = owner === null ? null : await activeRole(deps.db, owner.userId);
  if (owner === null || role === null) throw new ApiError("unauthorized", "sign in required");
  return { userId: owner.userId, role, via: "token" };
}

/** Throws 403 unless the caller is an admin. */
export function requireAdmin(principal: Principal): void {
  if (principal.role !== "admin") throw new ApiError("forbidden", "admins only");
}
