import { pino } from "pino";
import { ConfigError, loadMigrateConfig } from "../config.ts";
import { defaultMigrationsDir } from "./dir.ts";
import { migrateOnStart } from "./onStart.ts";
import { MigrationError } from "./runner.ts";

/**
 * `mise run migrate`: the manual tool. The api applies migrations itself on start; this applies
 * them by hand, on the same dedicated, timeout-free connection, but fails fast (no startup grace)
 * when the server cannot be reached. Exit codes: 0 ok, 1 migration or connection failure, 2
 * configuration error.
 */
export async function main(_argv: string[] = []): Promise<number> {
  try {
    const config = loadMigrateConfig(process.env);
    const { applied, ahead } = await migrateOnStart({
      url: config.databaseUrl,
      dir: config.migrationsDir ?? defaultMigrationsDir(),
      grace: "none",
      logger: pino({ name: "uroboros-migrate" }),
    });
    if (ahead.length > 0) {
      console.warn(`the database is ahead of this build; not in it: ${ahead.join(", ")}`);
    }
    console.log(applied.length === 0 ? "no pending migrations" : `applied: ${applied.join(", ")}`);
    return 0;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return 2;
    }
    if (err instanceof MigrationError) {
      console.error(err.message);
      return 1;
    }
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
