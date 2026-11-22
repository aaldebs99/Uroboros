import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, loadMigrateConfig } from "../config.ts";
import { createDb } from "../db/kysely.ts";
import { MigrationError, runMigrations } from "./runner.ts";

/** The repo-root `migrations/`: walk up from this file to the directory with pnpm-workspace.yaml. */
function defaultMigrationsDir(): string {
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

/** Exit codes: 0 ok, 1 migration failure, 2 configuration error. */
async function main(): Promise<number> {
  try {
    const config = loadMigrateConfig(process.env);
    const dir = resolve(process.env["UROBOROS_MIGRATIONS_DIR"] ?? defaultMigrationsDir());
    const db = createDb(config.databaseUrl);
    try {
      const { applied } = await runMigrations(db, dir);
      console.log(
        applied.length === 0 ? "no pending migrations" : `applied: ${applied.join(", ")}`,
      );
      return 0;
    } finally {
      await db.destroy();
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return 2;
    }
    if (err instanceof MigrationError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

process.exitCode = await main();
