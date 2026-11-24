import { z } from "@hono/zod-openapi";

/** The shortest password Uroboros accepts. */
export const MIN_PASSWORD_CHARS = 12;

export const Role = z.enum(["admin", "member"]).openapi("Role");
export type Role = z.infer<typeof Role>;

/** How an account signs in: a local password, or the OIDC provider. */
export const AuthMethod = z.enum(["local", "oidc"]).openapi("AuthMethod");
export type AuthMethod = z.infer<typeof AuthMethod>;

/** A local username: trimmed, lower-cased, 1–64 of a-z 0-9 . _ - */
export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{1,64}$/, "1–64 characters: a-z, 0-9, dot, underscore or hyphen")
  .openapi("Username");
export type Username = z.infer<typeof Username>;

const Password = z.string().min(MIN_PASSWORD_CHARS).max(1024);

/** The sign-in methods the server offers; `oidc.ready` is false until discovery succeeds. */
export const AuthMethods = z
  .object({
    local: z.boolean(),
    oidc: z.object({ displayName: z.string(), ready: z.boolean() }).nullable(),
  })
  .openapi("AuthMethods");
export type AuthMethods = z.infer<typeof AuthMethods>;

export const LocalLoginBody = z
  .object({ username: z.string().min(1).max(64), password: z.string().min(1).max(1024) })
  .openapi("LocalLoginBody");
export type LocalLoginBody = z.infer<typeof LocalLoginBody>;

/** The signed-in user. */
export const Me = z
  .object({
    id: z.uuid(),
    displayName: z.string(),
    email: z.string().nullable(),
    role: Role,
    method: AuthMethod,
    isBootstrap: z.boolean(),
  })
  .openapi("Me");
export type Me = z.infer<typeof Me>;

/** Where to send the browser after sign-out: the provider's end-session URL for SSO users. */
export const LogoutResult = z
  .object({ endSessionUrl: z.string().nullable() })
  .openapi("LogoutResult");
export type LogoutResult = z.infer<typeof LogoutResult>;

/** One of the caller's signed-in browsers. Times are ISO 8601. */
export const SessionView = z
  .object({
    id: z.string(),
    current: z.boolean(),
    userAgent: z.string().nullable(),
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime(),
  })
  .openapi("SessionView");
export type SessionView = z.infer<typeof SessionView>;

/** What a token may reach: `api` the REST API under `/api`, `mcp` the MCP server (`MCP_PATH`). */
export const TokenScope = z.enum(["api", "mcp"]).openapi("TokenScope");
export type TokenScope = z.infer<typeof TokenScope>;

export const ApiTokenView = z
  .object({
    id: z.uuid(),
    name: z.string(),
    scopes: z.array(TokenScope),
    /** A read-only token only reads: no REST write and no MCP tool that changes anything. */
    readOnly: z.boolean(),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime().nullable(),
  })
  .openapi("ApiTokenView");
export type ApiTokenView = z.infer<typeof ApiTokenView>;

export const NewApiTokenBody = z
  .object({
    name: z.string().trim().min(1).max(64),
    scopes: z
      .array(TokenScope)
      .min(1)
      .max(4)
      .default(["api"])
      .transform((scopes) => [...new Set(scopes)].sort()),
    readOnly: z.boolean().default(false),
  })
  .openapi("NewApiTokenBody");
export type NewApiTokenBody = z.input<typeof NewApiTokenBody>;

/** The caller's tokens, and whether the MCP server is on (an `mcp` token needs it on to be made). */
export const TokenList = z
  .object({ mcp: z.object({ enabled: z.boolean() }), tokens: z.array(ApiTokenView) })
  .openapi("TokenList");
export type TokenList = z.infer<typeof TokenList>;

/** A created token; `secret` is shown this once and never again. */
export const NewApiToken = z
  .object({ token: ApiTokenView, secret: z.string() })
  .openapi("NewApiToken");
export type NewApiToken = z.infer<typeof NewApiToken>;

export const ChangePasswordBody = z
  .object({ currentPassword: z.string().min(1).max(1024), newPassword: Password })
  .openapi("ChangePasswordBody");
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>;

/** A user as admins see it. */
export const AdminUser = z
  .object({
    id: z.uuid(),
    displayName: z.string(),
    username: z.string().nullable(),
    email: z.string().nullable(),
    role: Role,
    method: AuthMethod,
    disabled: z.boolean(),
    revoked: z.boolean(),
    isBootstrap: z.boolean(),
    lastLoginAt: z.iso.datetime().nullable(),
    claimsSyncedAt: z.iso.datetime().nullable(),
  })
  .openapi("AdminUser");
export type AdminUser = z.infer<typeof AdminUser>;

export const NewLocalUserBody = z
  .object({
    username: Username,
    displayName: z.string().trim().min(1).max(128),
    role: Role,
    password: Password,
  })
  .openapi("NewLocalUserBody");
export type NewLocalUserBody = z.infer<typeof NewLocalUserBody>;

export const AdminUserPatch = z
  .object({
    role: Role.optional(),
    disabled: z.boolean().optional(),
    displayName: z.string().trim().min(1).max(128).optional(),
  })
  .openapi("AdminUserPatch");
export type AdminUserPatch = z.infer<typeof AdminUserPatch>;

export const ResetPasswordBody = z.object({ password: Password }).openapi("ResetPasswordBody");
export type ResetPasswordBody = z.infer<typeof ResetPasswordBody>;
