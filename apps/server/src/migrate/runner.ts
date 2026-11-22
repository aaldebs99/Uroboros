import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Kysely, sql } from "kysely";
import type { Database } from "../db/schema.ts";
import { MIGRATE_KEY_NAME } from "../shared/lockKeys.ts";
import { MigrationError, parseMigrationName } from "./name.ts";

export { MigrationError };

interface MigrationFile {
  name: string;
  sql: string;
  sha256: string;
}

async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
  // Forward-only: a misnamed file could apply out of order, so reject before applying anything.
  const stamps = new Map<string, string>();
  for (const n of names) {
    const { timestamp } = parseMigrationName(n);
    const key = timestamp.toISOString();
    const other = stamps.get(key);
    if (other !== undefined) {
      throw new MigrationError(`migrations ${other} and ${n} share the same timestamp`);
    }
    stamps.set(key, n);
  }
  return Promise.all(
    names.map(async (name) => {
      const text = await readFile(join(dir, name), "utf8");
      return { name, sql: text, sha256: createHash("sha256").update(text).digest("hex") };
    }),
  );
}

export interface MigrationOutcome {
  /** The files this run applied, in order. */
  applied: string[];
  /**
   * Applied migrations this build has no file for: the database is ahead of the build (a
   * rollback). Not an error: every migration works with the release before it (CLAUDE.md).
   */
  ahead: string[];
}

async function applyAll(conn: Kysely<Database>, files: MigrationFile[]): Promise<MigrationOutcome> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`.execute(conn);
  const { rows } = await sql<{ name: string; sha256: string }>`
    SELECT name, sha256 FROM schema_migrations`.execute(conn);
  const applied = new Map(rows.map((r) => [r.name, r.sha256]));

  for (const file of files) {
    const recorded = applied.get(file.name);
    if (recorded !== undefined && recorded !== file.sha256) {
      throw new MigrationError(`migration ${file.name} was edited after it was applied`);
    }
  }

  const done: string[] = [];
  for (const file of files.filter((f) => !applied.has(f.name))) {
    try {
      await conn.transaction().execute(async (trx) => {
        await sql.raw(file.sql).execute(trx);
        await sql`INSERT INTO schema_migrations (name, sha256) VALUES (${file.name}, ${file.sha256})`.execute(
          trx,
        );
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new MigrationError(`migration ${file.name} failed: ${reason}`, { cause });
    }
    done.push(file.name);
  }
  const known = new Set(files.map((f) => f.name));
  return { applied: done, ahead: [...applied.keys()].filter((n) => !known.has(n)).sort() };
}

/**
 * Applies every pending `*.sql` file in `dir`, in filename order, one transaction per file.
 *
 * A session-level advisory lock serialises concurrent runners (several replicas may start at
 * once). Lock, checks and migrations all run on one dedicated connection so they share a session,
 * and the lock is released in `finally`.
 */
export async function runMigrations(db: Kysely<Database>, dir: string): Promise<MigrationOutcome> {
  const files = await readMigrations(dir);
  return db.connection().execute(async (conn) => {
    await sql`SELECT pg_advisory_lock(hashtext(${MIGRATE_KEY_NAME}))`.execute(conn);
    try {
      return await applyAll(conn, files);
    } finally {
      await sql`SELECT pg_advisory_unlock(hashtext(${MIGRATE_KEY_NAME}))`.execute(conn);
    }
  });
}
