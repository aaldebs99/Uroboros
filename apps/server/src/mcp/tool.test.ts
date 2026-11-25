import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { Kysely } from "kysely";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { defineTool, runTool, type ToolContext } from "./tool.ts";

const ctx: ToolContext = {
  caller: { userId: "u", tokenId: "t", readOnly: false },
  db: {} as Kysely<Database>,
  downloads: undefined,
  logger: pino({ level: "silent" }),
};

describe("a write tool", () => {
  /** Registers `tool` on a stand-in server and returns its handler. */
  function handlerOf(tool: ReturnType<typeof defineTool>, c: ToolContext) {
    let handler: ((args: unknown, call: unknown) => Promise<CallToolResult>) | undefined;
    const server = {
      registerTool: (_name: string, _config: unknown, h: typeof handler) => {
        handler = h;
      },
    } as unknown as McpServer;
    tool.register(server, c);
    if (handler === undefined) throw new Error("the tool registered no handler");
    return handler;
  }
  const call = { mcpReq: { signal: new AbortController().signal } };

  it("refuses a read-only caller without running, though such tools are never offered to one", async () => {
    const run = vi.fn(() => Promise.resolve({ ok: true }));
    const tool = defineTool({
      name: "change_it",
      title: "Change it",
      description: "Changes something",
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      write: true,
      run,
    });
    const readOnly = { ...ctx, caller: { ...ctx.caller, readOnly: true } };
    expect(await handlerOf(tool, readOnly)({}, call)).toEqual({
      content: [{ type: "text", text: "forbidden: this token is read-only" }],
      isError: true,
    });
    expect(run).not.toHaveBeenCalled();
    expect(await handlerOf(tool, ctx)({}, call)).toMatchObject({ structuredContent: { ok: true } });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("runTool", () => {
  it("returns what the tool made as structured content and as JSON text", async () => {
    const r = await runTool("t", ctx, () => Promise.resolve({ n: 1 }));
    expect(r).toEqual({
      content: [{ type: "text", text: '{"n":1}' }],
      structuredContent: { n: 1 },
    });
  });

  it("words an API error as the REST API does", async () => {
    const r = await runTool("t", ctx, () => Promise.reject(new ApiError("conflict", "taken")));
    expect(r).toEqual({ content: [{ type: "text", text: "conflict: taken" }], isError: true });
  });

  it("reports any other failure without its details", async () => {
    const r = await runTool("t", ctx, () =>
      Promise.reject(new Error("password authentication failed for user uroboros")),
    );
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r)).not.toContain("password");
    expect(r.content).toEqual([
      { type: "text", text: "internal: the tool failed; try again later" },
    ]);
  });
});
