import { generateVAPIDKeys } from "web-push";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import { ensureVapidKeys, vapidPairProblem } from "./keys.ts";

describe("vapidPairProblem", () => {
  it("accepts a generated pair", () => {
    const pair = generateVAPIDKeys();
    expect(vapidPairProblem(pair.publicKey, pair.privateKey)).toBeNull();
  });

  it("refuses halves of different pairs", () => {
    expect(vapidPairProblem(generateVAPIDKeys().publicKey, generateVAPIDKeys().privateKey)).toMatch(
      /not the public half/,
    );
  });

  it("refuses keys of the wrong shape", () => {
    const pair = generateVAPIDKeys();
    expect(vapidPairProblem("abc", pair.privateKey)).toMatch(/public key/);
    expect(vapidPairProblem(pair.publicKey, "abc")).toMatch(/private key/);
    expect(vapidPairProblem(pair.publicKey, "!!!")).toMatch(/private key/);
  });
});

describe("ensureVapidKeys", () => {
  let testDb: TestDb;
  beforeAll(async () => {
    testDb = await TestDb.create();
  });
  afterAll(() => testDb.close());

  it("makes one pair however many replicas ask at once, and keeps it", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => ensureVapidKeys(testDb.db)));
    const rows = await testDb.db.selectFrom("vapid_keys").selectAll().execute();
    expect(rows).toHaveLength(1);
    for (const keys of results) {
      expect(keys).toEqual({ publicKey: rows[0]?.public_key, privateKey: rows[0]?.private_key });
    }
    expect(vapidPairProblem(results[0]?.publicKey ?? "", results[0]?.privateKey ?? "")).toBeNull();
    expect(await ensureVapidKeys(testDb.db)).toEqual(results[0]);
  });
});
