import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import { hitsTable } from "./search.ts";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await TestDb.create();
});
afterAll(async () => {
  await testDb.close();
});

/** The plan of `terms`' hits for someone, with sequential scans made as costly as they get. */
async function plan(terms: string[]): Promise<string> {
  return testDb.db.transaction().execute(async (tx) => {
    await sql`SET LOCAL enable_seqscan = off`.execute(tx);
    const { rows } = await sql<{
      "QUERY PLAN": string;
    }>`EXPLAIN SELECT * FROM ${hitsTable(randomUUID(), terms)} AS h`.execute(tx);
    return rows.map((r) => r["QUERY PLAN"]).join("\n");
  });
}

describe("search plan", () => {
  it("finds matches through the trigram indexes, never by reading every row", async () => {
    for (const terms of [["dragon"], ["ai", "dragon"], ["the north", "lair"]]) {
      const p = await plan(terms);
      expect(p, terms.join(" ")).toContain("media_search_idx");
      expect(p, terms.join(" ")).toContain("media_chapters_search_idx");
    }
  });
});
