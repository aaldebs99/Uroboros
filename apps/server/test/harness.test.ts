import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { TestDb } from "./testDb.ts";

const MIGRATIONS = fileURLToPath(new URL("../../../migrations", import.meta.url));

describe("harness", () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((c) => c()));
  });

  it("clones a migrated template per TestDb", async () => {
    const a = await TestDb.create();
    const b = await TestDb.create();
    closers.push(
      () => a.close(),
      () => b.close(),
    );
    expect(a.url).not.toBe(b.url);
    // Migrated: every file in migrations/ is recorded, and the schema's tables are there.
    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql"));
    const applied = await sql<{ name: string }>`SELECT name FROM schema_migrations`.execute(a.db);
    expect(applied.rows.map((r) => r.name).sort()).toEqual(files.sort());
    expect(files.length).toBeGreaterThan(0);
    await expect(a.db.selectFrom("users").select("id").execute()).resolves.toEqual([]);
    // Apart: a row written in one clone is not in the other.
    await sql`CREATE TABLE harness_probe (n int)`.execute(a.db);
    const there = sql<{ t: string | null }>`SELECT to_regclass('harness_probe')::text AS t`;
    expect((await there.execute(a.db)).rows[0]?.t).toBe("harness_probe");
    expect((await there.execute(b.db)).rows[0]?.t).toBeNull();
  });
});
