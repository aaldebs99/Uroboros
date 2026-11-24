import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** `.env.example` documents every variable the code and the compose files read, and no other. */

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** The TypeScript files under a directory, tests included (the test setup reads its own). */
function sources(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dir, f));
}

const CODE_NAME = /\b(?:UROBOROS_[A-Z0-9_]*[A-Z0-9]|DATABASE_URL|YTDLP_PATH)\b/g;
const COMPOSE_NAME = /\$\{([A-Z][A-Z0-9_]*)/g;
/** A variable line: `NAME=value`, or the same commented out. */
const EXAMPLE_LINE = /^(?:# )?([A-Z][A-Z0-9_]*)=/gm;
/** Compose's own settings, which the example may set though no service reads them. */
const COMPOSE_SETTINGS = ["COMPOSE_FILE"];

function codeNames(): Set<string> {
  const files = [
    ...sources("apps/server/src"),
    ...sources("apps/server/test"),
    "apps/web/vite.config.ts",
  ];
  return new Set(files.flatMap((f) => read(f).match(CODE_NAME) ?? []));
}

function composeNames(): Set<string> {
  const files = [
    "compose.yaml",
    "compose.dev.yaml",
    ...readdirSync(join(root, "compose/gpu")).map((f) => `compose/gpu/${f}`),
  ];
  return new Set(files.flatMap((f) => [...read(f).matchAll(COMPOSE_NAME)].map((m) => m[1] ?? "")));
}

function exampleNames(): string[] {
  return [...read(".env.example").matchAll(EXAMPLE_LINE)].map((m) => m[1] ?? "");
}

describe(".env.example", () => {
  it("documents every variable the code and the compose files read", () => {
    const documented = new Set(exampleNames());
    const missing = [...codeNames(), ...composeNames()].filter((n) => !documented.has(n));
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it("documents nothing that nothing reads, each variable once", () => {
    const known = new Set([...codeNames(), ...composeNames(), ...COMPOSE_SETTINGS]);
    const names = exampleNames();
    expect(names.filter((n) => !known.has(n))).toEqual([]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});
