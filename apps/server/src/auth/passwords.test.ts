import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./passwords.ts";

describe("passwords", () => {
  it("hashes to an argon2id PHC string with the OWASP parameters", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("verifies the right password and refuses a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "Correct horse battery staple")).toBe(false);
  });

  it("refuses a malformed or foreign hash instead of throwing", async () => {
    expect(await verifyPassword("not a hash", "x")).toBe(false);
    expect(await verifyPassword("$2b$10$abcdefghijklmnopqrstuv", "x")).toBe(false);
  });

  it("verifies hashes made with other parameters (stored params win)", async () => {
    const hash = await hashPassword("pw", { memory: 8192, passes: 1 });
    expect(hash).toContain("m=8192,t=1,p=1");
    expect(await verifyPassword(hash, "pw")).toBe(true);
  });

  it("has a dummy hash that verifies nothing", async () => {
    expect(await verifyPassword(DUMMY_HASH, "")).toBe(false);
  });
});
