import { McpServer } from "@modelcontextprotocol/server";
import type { Tool, ToolContext } from "./tool.ts";
import { curateTools } from "./tools/curate.ts";
import { downloadTools } from "./tools/downloads.ts";
import { libraryTools } from "./tools/library.ts";

const TOOLS: readonly Tool[] = [...libraryTools, ...downloadTools, ...curateTools];

const INSTRUCTIONS =
  "Uroboros is the person's self-hosted video library and downloader. Every tool acts as the person whose token this is, on their own library and what others shared with them.";

/** A fresh server for one request, offering the caller's tools (only reading ones if read-only). */
export function buildMcpServer(ctx: ToolContext, version: string): McpServer {
  const server = new McpServer({ name: "uroboros", version }, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) {
    if (!tool.write || !ctx.caller.readOnly) tool.register(server, ctx);
  }
  return server;
}
