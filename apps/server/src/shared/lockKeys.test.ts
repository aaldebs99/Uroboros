import { describe, expect, it } from "vitest";
import { lockKey, MIGRATE_KEY_NAME, ROLE_KEYS, roleKey, URO_LEAD } from "./lockKeys.ts";

describe("advisory lock keys", () => {
  it("encodes a role as its 8 ASCII bytes, big-endian", () => {
    expect(roleKey("URO_LEAD")).toBe(0x55524f5f4c454144n);
    expect(URO_LEAD).toBe(roleKey("URO_LEAD"));
  });

  it("refuses a role name that is not exactly 8 ASCII bytes", () => {
    expect(() => roleKey("SHORT")).toThrow(/8 ASCII/);
    expect(() => roleKey("URO_LÉAD")).toThrow(/8 ASCII/);
  });

  it("builds a per-resource key from a 4-byte namespace and the resource's sha256", () => {
    const key = lockKey("REAP", "media/42");
    // "REAP" in the high four bytes.
    expect(key >> 32n).toBe(0x52454150n);
    expect(lockKey("REAP", "media/42")).toBe(key);
    expect(lockKey("REAP", "media/43")).not.toBe(key);
    expect(() => lockKey("TOOLONG", "x")).toThrow(/4 ASCII/);
  });

  it("gives every role and per-resource key a value of its own", () => {
    const keys = [
      ...Object.values(ROLE_KEYS),
      lockKey("REAP", "a"),
      lockKey("REAP", "b"),
      lockKey("SYNC", "a"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toBeLessThan(2n ** 63n);
      // Above every int4, so none can meet the migration lock, hashtext(MIGRATE_KEY_NAME).
      expect(key).toBeGreaterThan(2n ** 32n);
    }
    // The migration lock keeps the name earlier releases' runners lock on.
    expect(MIGRATE_KEY_NAME).toBe("uroboros_migrate");
  });
});
