import { describe, expect, it } from "vitest";
import { digest, isSecretShape, newSecret, safeEqual } from "./secrets.ts";

describe("secrets", () => {
  it("makes 64 lowercase hex characters, different every time", () => {
    const a = newSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newSecret()).not.toBe(a);
  });

  it("digests to 32 bytes of SHA-256", () => {
    expect(digest("abc").toString("hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("recognises only the secret shape", () => {
    expect(isSecretShape(newSecret())).toBe(true);
    expect(isSecretShape("A".repeat(64))).toBe(false);
    expect(isSecretShape("a".repeat(63))).toBe(false);
  });

  it("compares in constant time and tolerates different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
