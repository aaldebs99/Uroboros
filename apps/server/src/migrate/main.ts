import { resolve } from "node:path";
import { ConfigError, loadMigrateConfig } from "../config.ts";
import { createDb } from "../db/kysely.ts";
import { defaultMigrationsDir } from "./dir.ts";
import { MigrationError, runMigrations } from "./runner.ts";

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
