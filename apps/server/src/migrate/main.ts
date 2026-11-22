import { ConfigError, loadMigrateConfig } from "../config.ts";
import { createDb } from "../db/kysely.ts";
import { defaultMigrationsDir } from "./dir.ts";
import { MigrationError, runMigrations } from "./runner.ts";

/** Exit codes: 0 ok, 1 migration failure, 2 configuration error. */
export async function main(_argv: string[] = []): Promise<number> {
  try {
    const config = loadMigrateConfig(process.env);
    const dir = config.migrationsDir ?? defaultMigrationsDir();
    // No query timeout: a migration, or the wait for another runner's lock, may take minutes; the
    // Job's activeDeadlineSeconds bounds it instead.
    const db = createDb(config.databaseUrl, undefined, { queryTimeoutMs: 0 });
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
