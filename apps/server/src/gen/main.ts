import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createApp } from "../api/app.ts";
import { openApiConfig } from "../api/openapiDoc.ts";
import { findRepoRoot } from "../shared/repoRoot.ts";

/** A stand-in that throws on any use: the document is built without touching a dependency. */
function untouchable(name: string): never {
  const trap = new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`gen must not use ${name} (accessed ${String(prop)})`);
      },
    },
  );
  return trap as never;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function serverVersion(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, "apps/server/package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

/** The OpenAPI document the app serves, as deterministic JSON (sorted keys, 2 spaces, newline). */
export function renderOpenApi(): string {
  const version = serverVersion(findRepoRoot());
  const app = createApp(
    {
      db: untouchable("db"),
      version,
    },
    { webDist: null },
  );
  const doc = app.getOpenAPIDocument(openApiConfig(version));
  return `${JSON.stringify(sortKeys(doc), null, 2)}\n`;
}

/** First differing line, 1-based, with both texts. */
function summarize(expected: string, actual: string): string {
  const e = expected.split("\n");
  const a = actual.split("\n");
  const n = Math.max(e.length, a.length);
  for (let i = 0; i < n; i++) {
    if (e[i] !== a[i]) {
      return `api/openapi.json differs at line ${String(i + 1)}\n  expected: ${e[i] ?? "<end of file>"}\n  actual:   ${a[i] ?? "<end of file>"}\nrun \`mise run gen\``;
    }
  }
  return "api/openapi.json differs\nrun `mise run gen`";
}

/** `gen [--check] [--file <path>]`. Exit codes: 0 ok, 1 drift or missing file, 2 bad usage. */
export function main(argv: string[] = []): Promise<number> {
  const fileIdx = argv.indexOf("--file");
  const fileArg = fileIdx === -1 ? undefined : argv[fileIdx + 1];
  if (fileIdx !== -1 && fileArg === undefined) {
    console.error("--file needs a path");
    return Promise.resolve(2);
  }
  const target = fileArg ?? join(findRepoRoot(), "api/openapi.json");
  const rendered = renderOpenApi();
  if (argv.includes("--check")) {
    if (!existsSync(target)) {
      console.error("api/openapi.json is missing\nrun `mise run gen`");
      return Promise.resolve(1);
    }
    const current = readFileSync(target, "utf8");
    if (current !== rendered) {
      console.error(summarize(rendered, current));
      return Promise.resolve(1);
    }
    console.log("api/openapi.json is up to date");
    return Promise.resolve(0);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, rendered);
  console.log("wrote api/openapi.json");
  return Promise.resolve(0);
}
