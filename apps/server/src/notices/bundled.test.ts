import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED } from "./bundled.ts";
import { renderNotices } from "./notices.ts";

const require = createRequire(import.meta.url);

/** Where an installed package lives: up from its entry to the package.json naming it. */
function packageDir(name: string): string {
  let dir = dirname(require.resolve(name));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (pkg.name === name) return dir;
    } catch {
      // no package.json here; keep climbing
    }
    const up = dirname(dir);
    if (up === dir) throw new Error(`${name} is not installed`);
    dir = up;
  }
}

/** The packages a host compiled into its dist, from the bundler's region markers. */
function regionsIn(host: string): string[] {
  const dist = join(packageDir(host), "dist");
  const found = new Set<string>();
  for (const file of readdirSync(dist)) {
    if (!/\.(c|m)?js$/.test(file)) continue;
    for (const [, dir] of readFileSync(join(dist, file), "utf8").matchAll(
      /\/\/#region \.\.\/\.\.\/node_modules\/\.pnpm\/([^/\s]+)/g,
    )) {
      // `ajv-formats@3.0.1_ajv@8.18.0` (a peer suffix), `@cfworker+json-schema@4.1.1` (a scope)
      const spec = (dir ?? "").split("_")[0] ?? "";
      found.add(spec.replace("+", "/"));
    }
  }
  return [...found].sort();
}

const sdk = (version: string) => ({
  name: "@modelcontextprotocol/server",
  versions: [version],
  paths: [packageDir("@modelcontextprotocol/server")],
  license: "Apache-2.0",
});

describe("notices for code compiled into other packages", () => {
  it("name exactly what each installed host bundles, at its installed version", () => {
    for (const host of BUNDLED) {
      const installed = (
        JSON.parse(readFileSync(join(packageDir(host.name), "package.json"), "utf8")) as {
          version: string;
        }
      ).version;
      expect([host.name, installed]).toEqual([host.name, host.version]);
      expect(host.packages.map((p) => `${p.name}@${p.version}`).sort()).toEqual(
        regionsIn(host.name),
      );
    }
  });

  it("are appended after the host's own entry, with each licence's text", () => {
    const text = renderNotices({ "Apache-2.0": [sdk("2.4.0")] });
    const at = text.indexOf("Bundled inside @modelcontextprotocol/server@2.4.0");
    expect(at).toBeGreaterThan(text.indexOf("@modelcontextprotocol/server@2.4.0\n"));
    expect(text.slice(at)).toContain("ajv@8.18.0\nLicence: MIT");
    expect(text.slice(at)).toContain("Copyright (c) 2015-2021 Evgeny Poberezkin");
    expect(text.slice(at)).toContain("fast-uri@3.1.8\nLicence: BSD-3-Clause");
  });

  it("refuse a host at a version whose bundled code nobody listed", () => {
    expect(() => renderNotices({ "Apache-2.0": [sdk("2.5.0")] })).toThrow(
      /@modelcontextprotocol\/server@2\.5\.0 bundles code .* src\/notices\/bundled\.ts/,
    );
  });
});
