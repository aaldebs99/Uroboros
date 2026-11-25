import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  type ApiTokenView,
  NewApiToken,
  NewApiTokenBody,
  TokenList,
  type TokenScope,
} from "@uroboros/contract";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import type { ResolveToken } from "./guard.ts";
import { digest, newSecret } from "./secrets.ts";

export const MAX_TOKENS_PER_USER = 20;
/** `last_used_at` is written at most this often per token. */
const USED_THROTTLE_MS = 60_000;
const UNIQUE_VIOLATION = "23505";

/** The owner and reach of an API token; the guard re-checks the owner is still active. */
export const resolveToken: ResolveToken = async (db, secret) => {
  const hash = digest(secret);
  const row = await db
    .selectFrom("api_tokens")
    .select(["id", "user_id", "last_used_at", "scopes", "read_only"])
    .where("token_hash", "=", hash)
    .executeTakeFirst();
  if (row === undefined) return null;
  if (row.last_used_at === null || Date.now() - row.last_used_at.getTime() > USED_THROTTLE_MS) {
    await db
      .updateTable("api_tokens")
      .set({ last_used_at: new Date() })
      .where("id", "=", row.id)
      .execute();
  }
  return { userId: row.user_id, tokenId: row.id, scopes: row.scopes, readOnly: row.read_only };
};

const COLUMNS = ["id", "name", "scopes", "read_only", "created_at", "last_used_at"] as const;

const view = (r: {
  id: string;
  name: string;
  scopes: TokenScope[];
  read_only: boolean;
  created_at: Date;
  last_used_at: Date | null;
}): ApiTokenView => ({
  id: r.id,
  name: r.name,
  scopes: r.scopes,
  readOnly: r.read_only,
  createdAt: r.created_at.toISOString(),
  lastUsedAt: r.last_used_at?.toISOString() ?? null,
});

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const idParams = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" }, description: "Token id" }),
});

const listRoute = createRoute({
  method: "get",
  path: "/api/me/tokens",
  tags: ["tokens"],
  summary: "The caller's API tokens (never their secrets), and whether the MCP server is on",
  responses: { 200: json(TokenList, "Tokens"), 403: error("Called with an API token") },
});

const createTokenRoute = createRoute({
  method: "post",
  path: "/api/me/tokens",
  tags: ["tokens"],
  summary: "Create an API token; its secret is shown once",
  request: {
    body: { required: true, content: { "application/json": { schema: NewApiTokenBody } } },
  },
  responses: {
    200: json(NewApiToken, "The token and its secret"),
    409: error("A token with that name exists, or it asks for MCP while the MCP server is off"),
    422: error("The caller has as many tokens as allowed"),
  },
});

const deleteTokenRoute = createRoute({
  method: "delete",
  path: "/api/me/tokens/{id}",
  tags: ["tokens"],
  summary: "Revoke one of the caller's API tokens",
  request: { params: idParams },
  responses: { 204: { description: "Revoked" }, 404: error("No such token") },
});

interface NewToken {
  userId: string;
  name: string;
  scopes: TokenScope[];
  readOnly: boolean;
  secret: string;
}

/** Stores a new token's digest, within the per-user cap and with a name unique to its owner. */
async function insertToken(tx: Transaction<Database>, t: NewToken) {
  const { n } = await tx
    .selectFrom("api_tokens")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("user_id", "=", t.userId)
    .executeTakeFirstOrThrow();
  if (Number(n) >= MAX_TOKENS_PER_USER) {
    throw new ApiError("unprocessable", `at most ${String(MAX_TOKENS_PER_USER)} tokens per user`);
  }
  try {
    return await tx
      .insertInto("api_tokens")
      .values({
        user_id: t.userId,
        name: t.name,
        scopes: t.scopes,
        read_only: t.readOnly,
        token_hash: digest(t.secret),
      })
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new ApiError("conflict", "a token with that name already exists");
    }
    throw err;
  }
}

export function registerTokenRoutes(
  app: OpenAPIHono,
  db: Kysely<Database>,
  { mcpEnabled = true }: { mcpEnabled?: boolean | undefined } = {},
): void {
  app.openapi(listRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const rows = await db
      .selectFrom("api_tokens")
      .select(COLUMNS)
      .where("user_id", "=", userId)
      .orderBy("created_at")
      .execute();
    return c.json({ mcp: { enabled: mcpEnabled }, tokens: rows.map(view) }, 200);
  });

  app.openapi(createTokenRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const { name, scopes, readOnly } = c.req.valid("json");
    if (scopes.includes("mcp") && !mcpEnabled) {
      throw new ApiError("conflict", "the MCP server is off (UROBOROS_MCP_ENABLED)");
    }
    const secret = newSecret();
    const row = await db
      .transaction()
      .execute((tx) => insertToken(tx, { userId, name, scopes, readOnly, secret }));
    return c.json({ token: view(row), secret }, 200);
  });

  app.openapi(deleteTokenRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const res = await db
      .deleteFrom("api_tokens")
      .where("id", "=", c.req.valid("param").id)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (res.numDeletedRows === 0n) throw new ApiError("not_found", "no such token");
    return c.body(null, 204);
  });
}
