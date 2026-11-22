import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { TestDb } from "./testDb.ts";
import { TestValkey } from "./testValkey.ts";

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

  it("clears only the keys under a prefix", async () => {
    const redis = new Redis(TestValkey.url());
    const mine = `harness-${randomUUID()}`;
    const other = `harness-${randomUUID()}`;
    try {
      await redis.set(`${mine}:a`, "v");
      await redis.set(`${mine}:b`, "v");
      await redis.set(`${other}:a`, "v");
      await TestValkey.clear(mine);
      expect(await redis.exists(`${mine}:a`, `${mine}:b`)).toBe(0);
      expect(await redis.get(`${other}:a`)).toBe("v");
    } finally {
      await redis.del(`${other}:a`);
      redis.disconnect();
    }
  });
});
