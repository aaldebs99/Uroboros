import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/api/health", "/api/ready", "/api/info"]),
    );
  });

  it("only publishes schemas that the contract exports", async () => {
    const contract = Object.keys(await import("@uroboros/contract"));
    const doc = JSON.parse(renderOpenApi()) as Doc;
    const schemas = Object.keys(doc.components?.schemas ?? {});
    expect(schemas.length).toBeGreaterThan(0);
    for (const name of schemas) expect(contract).toContain(name);
  });
});

describe("gen --check through the real entrypoint", () => {
  const bin = fileURLToPath(new URL("../bin/gen.ts", import.meta.url));
  const serverDir = fileURLToPath(new URL("../..", import.meta.url));
  let tmp: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "gen-"));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function check(file: string) {
    return spawnSync(process.execPath, ["--import", "tsx", bin, "--check", "--file", file], {
      cwd: serverDir,
      encoding: "utf8",
    });
  }

  it("exits 1 on drift, also via a symlinked path", () => {
    const real = join(tmp, "openapi.json");
    writeFileSync(real, renderOpenApi().replace("Uroboros API", "Drifted"));
    const link = join(tmp, "link");
    symlinkSync(tmp, link);
    for (const file of [real, join(link, "openapi.json")]) {
      const r = check(file);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("run `mise run gen`");
    }
  });

  it("exits 1 when the file is missing", () => {
    const r = check(join(tmp, "absent.json"));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("missing");
  });

  it("exits 0 when up to date", () => {
    const ok = join(tmp, "ok.json");
    writeFileSync(ok, renderOpenApi());
    expect(check(ok).status).toBe(0);
  });
});
