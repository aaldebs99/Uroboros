import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { z } from "zod";
import type { Database } from "../db/schema.ts";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { ApiError } from "../api/errors.ts";
import type { McpCaller } from "./caller.ts";

/** What a tool runs with: its caller and the server's parts. */
export interface ToolContext {
  caller: McpCaller;
  db: Kysely<Database>;
  /** Downloads and subscriptions; their tools answer `unavailable` without it. */
  downloads: DownloadContext | undefined;
  /** The tallest encode (`UROBOROS_TRANSCODE_MAX_HEIGHT`): what an entry's qualities stop at. */
  maxShort: number;
  logger: Logger;
}

/** A tool, its types erased once defined, ready to register on each request's server. */
export interface Tool {
  name: string;
  /** Changes something: never offered to a read-only token. */
  write: boolean;
  register(server: McpServer, ctx: ToolContext): void;
}

interface ToolSpec<I extends z.ZodObject, O extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: I;
  output: O;
  /** Changes something (anything else only reads). */
  write?: boolean;
  /** Removes or cancels something that cannot be had back. */
  destructive?: boolean;
  /** Calling it twice with the same arguments does no more than once. */
  idempotent?: boolean;
  /** Reaches other sites (yt-dlp reads a link or a feed), not just the library. */
  openWorld?: boolean;
  /** `signal` aborts when the client cancels the call or goes away. */
  run(args: z.output<I>, ctx: ToolContext, signal: AbortSignal): Promise<z.input<O>>;
}

const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });

/**
 * Runs a tool for its result: what it returns goes back as structured content (and as JSON text
 * for clients that read only text); an `ApiError` comes back as the tool's own error, worded as
 * the REST API words it, and anything else is logged and reported without its details.
 */
export async function runTool(
  name: string,
  ctx: ToolContext,
  run: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  const started = performance.now();
  try {
    const out = await run();
    return { ...text(JSON.stringify(out)), structuredContent: out };
  } catch (err) {
    if (err instanceof ApiError) return { ...text(`${err.code}: ${err.message}`), isError: true };
    ctx.logger.error({ err, tool: name, userId: ctx.caller.userId }, "MCP tool failed");
    return { ...text("internal: the tool failed; try again later"), isError: true };
  } finally {
    ctx.logger.info(
      { tool: name, userId: ctx.caller.userId, ms: Math.round(performance.now() - started) },
      "MCP tool",
    );
  }
}

/**
 * A zod schema as the SDK takes it. Every zod 4 schema is a Standard Schema with JSON Schema, but
 * TypeScript cannot see that through a type parameter, so the one cast lives here.
 */
const standard = <S extends z.ZodType>(schema: S) =>
  schema as unknown as StandardSchemaWithJSON<z.input<S>, z.output<S>>;

export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(
  spec: ToolSpec<I, O>,
): Tool {
  const write = spec.write ?? false;
  return {
    name: spec.name,
    write,
    register(server, ctx) {
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: standard(spec.input),
          outputSchema: standard(spec.output),
          annotations: {
            title: spec.title,
            readOnlyHint: !write,
            destructiveHint: spec.destructive ?? false,
            idempotentHint: spec.idempotent ?? !write,
            openWorldHint: spec.openWorld ?? false,
          },
        },
        (args, call) =>
          runTool(spec.name, ctx, async () => {
            if (write && ctx.caller.readOnly) {
              throw new ApiError("forbidden", "this token is read-only");
            }
            return spec.run(args, ctx, call.mcpReq.signal);
          }),
      );
    },
  };
}
