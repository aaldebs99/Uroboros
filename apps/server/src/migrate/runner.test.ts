import { fileURLToPath } from "node:url";
import { type Kysely, sql } from "kysely";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { createDb } from "../db/kysely.ts";
import type { Database } from "../db/schema.ts";
import { MigrationError, runMigrations } from "./runner.ts";
import { createEmptyDatabase } from "../../test/testDb.ts";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));

const A = "20260101000000_a.sql";
const B = "20260101000001_b.sql";

describe("runMigrations", () => {
  let url: string;
  let empty: Awaited<ReturnType<typeof createEmptyDatabase>>;
  const open: Kysely<Database>[] = [];
  const connect = (): Kysely<Database> => {
    const db = createDb(url);
    open.push(db);
    return db;
  };

  beforeEach(async () => {
    empty = await createEmptyDatabase(inject("postgresUrl"));
    url = empty.url;
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((db) => db.destroy()));
    await empty.drop();
  });

  it("applies pending files in order, then nothing", async () => {
    const db = connect();
    expect(await runMigrations(db, fixture("migrations-ok"))).toEqual({ applied: [A, B] });
    expect(await runMigrations(db, fixture("migrations-ok"))).toEqual({ applied: [] });
  });

  it("applies exactly once under concurrent runners on separate pools", async () => {
    // Hold the lock from a third session so both runners are provably queued behind it.
    const holder = new pg.Client({ connectionString: url });
    await holder.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext('uroboros_migrate'))");
      const runs = [
        runMigrations(connect(), fixture("migrations-ok")),
        runMigrations(connect(), fixture("migrations-ok")),
      ];
      await vi.waitFor(async () => {
        const r = await holder.query<{ n: string }>(`
          SELECT count(*)::text AS n FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
        expect(r.rows[0]?.n).toBe("2");
      });
      await holder.query("SELECT pg_advisory_unlock(hashtext('uroboros_migrate'))");
      const results = await Promise.all(runs);
      expect(results.map((r) => r.applied.length).sort()).toEqual([0, 2]);
    } finally {
      await holder.end();
    }
  });

  it("rejects misnamed files naming them, before applying anything", async () => {
    const db = connect();
    const err = await runMigrations(db, fixture("migrations-bad-name")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as MigrationError).message).toContain("notes.sql");
    const t = await sql<{
      t: string | null;
    }>`SELECT to_regclass('schema_migrations')::text AS t`.execute(db);
    expect(t.rows[0]?.t).toBeNull();
  });

  it("rejects an edited, already-applied file naming it", async () => {
    const db = connect();
    await runMigrations(db, fixture("migrations-ok"));
    const err = await runMigrations(db, fixture("migrations-edited")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as MigrationError).message).toContain(A);
  });

  it("rolls back a failing file and keeps earlier ones", async () => {
    const db = connect();
    const err = await runMigrations(db, fixture("migrations-bad-sql")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as MigrationError).message).toContain(B);
    const rows = await sql<{ name: string }>`SELECT name FROM schema_migrations`.execute(db);
    expect(rows.rows.map((r) => r.name)).toEqual([A]);
    const gadgets = await sql<{
      t: string | null;
    }>`SELECT to_regclass('gadgets')::text AS t`.execute(db);
    expect(gadgets.rows[0]?.t).toBeNull();
  });

  it("releases the advisory lock afterwards", async () => {
    const db = connect();
    await runMigrations(db, fixture("migrations-ok"));
    const r = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM pg_locks WHERE locktype = 'advisory'`.execute(db);
    expect(r.rows[0]?.n).toBe("0");
  });
});
