import type { Kysely } from "kysely";
import { digest, newSecret } from "../src/auth/secrets.ts";
import type { Database } from "../src/db/schema.ts";

/** An API token for `userId` (MCP only by default); returns its secret. */
export async function mcpToken(
  db: Kysely<Database>,
  userId: string,
  opts: { scopes?: ("api" | "mcp")[]; readOnly?: boolean } = {},
): Promise<string> {
  const secret = newSecret();
  await db
    .insertInto("api_tokens")
    .values({
      user_id: userId,
      name: `mcp ${secret.slice(0, 8)}`,
      token_hash: digest(secret),
      scopes: opts.scopes ?? ["mcp"],
      read_only: opts.readOnly ?? false,
    })
    .execute();
  return secret;
}

/** Turns the MCP server on or off, as an admin would. */
export async function setMcp(db: Kysely<Database>, on: boolean): Promise<void> {
  await db
    .insertInto("instance_settings")
    .values({ id: 1, mcp_enabled: on })
    .onConflict((oc) => oc.column("id").doUpdateSet({ mcp_enabled: on }))
    .execute();
}

interface Requester {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

let nextId = 1;

/** Posts one JSON-RPC request to the MCP endpoint as a 2025-era client does (no session). */
export function mcpPost(app: Requester, secret: string, method: string, params?: unknown) {
  return app.request("/api/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
}

export interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

/** Calls one tool and returns its result (a tool's own failure is an `isError` result). */
export async function callTool(
  app: Requester,
  secret: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const res = await mcpPost(app, secret, "tools/call", { name, arguments: args });
  if (res.status !== 200) throw new Error(`tools/call ${name}: HTTP ${String(res.status)}`);
  const body = (await res.json()) as { result?: ToolResult; error?: { message: string } };
  if (body.result === undefined)
    throw new Error(`tools/call ${name}: ${body.error?.message ?? "?"}`);
  return body.result;
}

/** The names of the tools a token is offered. */
export async function toolNames(app: Requester, secret: string): Promise<string[]> {
  const res = await mcpPost(app, secret, "tools/list");
  const body = (await res.json()) as { result: { tools: { name: string }[] } };
  return body.result.tools.map((t) => t.name).sort();
}
