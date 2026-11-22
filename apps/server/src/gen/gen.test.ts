import { describe, expect, it } from "vitest";
import { renderOpenApi } from "./main.ts";

interface Doc {
  paths: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown> };
}

describe("renderOpenApi", () => {
  it("is deterministic", () => {
    expect(renderOpenApi()).toBe(renderOpenApi());
  });

  it("ends with a newline and documents the health and info paths", () => {
    const text = renderOpenApi();
    expect(text.endsWith("}\n")).toBe(true);
    const doc = JSON.parse(text) as Doc;
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/api/health", "/api/info"]));
  });

  it("only publishes schemas that the contract exports", async () => {
    const contract = Object.keys(await import("@uroboros/contract"));
    const doc = JSON.parse(renderOpenApi()) as Doc;
    const schemas = Object.keys(doc.components?.schemas ?? {});
    expect(schemas.length).toBeGreaterThan(0);
    for (const name of schemas) expect(contract).toContain(name);
  });
});
