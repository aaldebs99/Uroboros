import type { Kysely } from "kysely";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { runTool, type ToolContext } from "./tool.ts";

const ctx: ToolContext = {
  caller: { userId: "u", tokenId: "t", readOnly: false },
  db: {} as Kysely<Database>,
  downloads: undefined,
  logger: pino({ level: "silent" }),
};

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
