import type { OpenAPIHono } from "@hono/zod-openapi";
import { MCP_PATH } from "@uroboros/contract";
import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  type AuthInfo,
  type McpServer,
  type McpServerFactory,
} from "@modelcontextprotocol/server";
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { ApiError, errorResponse } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { readInstanceSettings } from "../settings/store.ts";
import { fromAuthInfo, toAuthInfo } from "./caller.ts";
import { buildMcpServer } from "./server.ts";

export interface McpDeps {
  db: Kysely<Database>;
  downloads: DownloadContext | undefined;
  logger: Logger;
  version: string;
}

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0",
  error: { code: -32000, message: "Method not allowed." },
  id: null,
};

/**
 * A 2025-era request: the SDK's stateless serving, but answered in plain JSON rather than a
 * one-message event stream, like the modern path. Stateless means no session to open a stream
 * on (GET) or end (DELETE).
 */
async function serveLegacy(
  request: Request,
  authInfo: AuthInfo,
  factory: (info: AuthInfo) => McpServer,
): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json(METHOD_NOT_ALLOWED, { status: 405, headers: { allow: "POST" } });
  }
  const server = factory(authInfo);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { authInfo });
  } finally {
    await transport.close();
    await server.close();
  }
}

/**
 * The MCP server at `MCP_PATH` (docs/mcp.md): stateless, so any replica answers any request,
 * each with a fresh server and a plain JSON reply. The guard has already let only a token with
 * the `mcp` scope through; the admin's switch is read on every request.
 */
export function registerMcpRoute(app: OpenAPIHono, deps: McpDeps): void {
  const build = (info: AuthInfo | undefined) =>
    buildMcpServer(
      {
        caller: fromAuthInfo(info),
        db: deps.db,
        downloads: deps.downloads,
        logger: deps.logger,
      },
      deps.version,
    );
  const factory: McpServerFactory = (req) => build(req.authInfo);
  const modern = createMcpHandler(factory, {
    legacy: "reject",
    responseMode: "json",
    onerror: (err) => {
      deps.logger.warn({ err }, "MCP request refused");
    },
  });

  app.on(["GET", "POST", "DELETE"], MCP_PATH, async (c) => {
    if (!(await readInstanceSettings(deps.db)).mcpEnabled) {
      throw new ApiError("not_found", "the MCP server is off");
    }
    const principal = currentPrincipal(c);
    if (principal.token === undefined)
      throw new ApiError("unauthorized", "an API token is required");
    const caller = {
      userId: principal.userId,
      tokenId: principal.token.id,
      readOnly: principal.token.readOnly,
    };
    const authInfo = toAuthInfo(caller);
    const request = c.req.raw;
    return (await isLegacyRequest(request))
      ? serveLegacy(request, authInfo, build)
      : modern.fetch(request, { authInfo });
  });

  // MCP clients look for an OAuth server after a 401; there is none, so say so in JSON rather
  // than let the web app answer with its page.
  app.all("/.well-known/*", (c) => errorResponse(c, "not_found", "not found"));
}
