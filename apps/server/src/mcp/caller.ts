import type { AuthInfo } from "@modelcontextprotocol/server";

/** Who an MCP request acts for: the token's owner, always with a member's reach. */
export interface McpCaller {
  userId: string;
  tokenId: string;
  /** A read-only token is offered (and may call) only the tools that change nothing. */
  readOnly: boolean;
}

/** The caller as the SDK carries it from the route to the per-request server factory. */
export function toAuthInfo(caller: McpCaller): AuthInfo {
  return {
    token: caller.tokenId,
    clientId: caller.userId,
    scopes: caller.readOnly ? ["mcp", "read"] : ["mcp", "read", "write"],
  };
}

/** The caller back from the SDK's `authInfo`; the route always sets it. */
export function fromAuthInfo(info: AuthInfo | undefined): McpCaller {
  if (info === undefined) throw new Error("an MCP request without its caller");
  return { userId: info.clientId, tokenId: info.token, readOnly: !info.scopes.includes("write") };
}
