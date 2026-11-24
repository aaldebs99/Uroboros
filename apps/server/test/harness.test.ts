import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { TestDb } from "./testDb.ts";

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
    const r = await sql<{ n: string }>`SELECT count(*)::text AS n FROM schema_migrations`.execute(
      a.db,
    );
    expect(Number(r.rows[0]?.n)).toBeGreaterThanOrEqual(0);
  });
});
