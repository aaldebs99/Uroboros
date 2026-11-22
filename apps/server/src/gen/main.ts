import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp, openApiConfig } from "../api/app.ts";
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
      valkey: untouchable("valkey"),
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

/** Exit codes: 0 ok, 1 drift or missing file. */
function main(args: string[]): number {
  const target = join(findRepoRoot(), "api/openapi.json");
  const rendered = renderOpenApi();
  if (args.includes("--check")) {
    if (!existsSync(target)) {
      console.error("api/openapi.json is missing\nrun `mise run gen`");
      return 1;
    }
    const current = readFileSync(target, "utf8");
    if (current !== rendered) {
      console.error(summarize(rendered, current));
      return 1;
    }
    console.log("api/openapi.json is up to date");
    return 0;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, rendered);
  console.log("wrote api/openapi.json");
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exit(main(process.argv.slice(2)));
}
