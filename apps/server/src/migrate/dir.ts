import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError } from "../config.ts";

/** The repo-root `migrations/`: walk up from this file to the directory with pnpm-workspace.yaml. */
export function defaultMigrationsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new ConfigError("cannot find the repo root; set UROBOROS_MIGRATIONS_DIR");
    }
    dir = parent;
  }
  return join(dir, "migrations");
}
