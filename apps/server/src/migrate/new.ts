import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultMigrationsDir } from "./dir.ts";
import { parseMigrationName } from "./name.ts";

/** `mise run migration:new <name>`: writes an empty, UTC-timestamped migration. */
function main(name: string | undefined): number {
  if (name === undefined) {
    console.error("usage: migration:new <snake_case_name>");
    return 2;
  }
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const file = `${stamp}_${name}.sql`;
  try {
    parseMigrationName(file);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  const path = join(process.env["UROBOROS_MIGRATIONS_DIR"] ?? defaultMigrationsDir(), file);
  if (existsSync(path)) {
    console.error(`${path} already exists`);
    return 1;
  }
  writeFileSync(
    path,
    `-- ${file}\n-- Forward-only: never edit this file once it has been applied anywhere.\n\n`,
    {
      flag: "wx",
    },
  );
  console.log(path);
  return 0;
}

process.exitCode = main(process.argv[2]);
