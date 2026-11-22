import { join } from "node:path";
import { findRepoRoot } from "../shared/repoRoot.ts";

/** The repo-root `migrations/`. */
export function defaultMigrationsDir(): string {
  return join(findRepoRoot(), "migrations");
}
