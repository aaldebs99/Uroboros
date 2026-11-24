import { describe, expect, it } from "vitest";

import { open, seal } from "./seal.ts";

const key = Buffer.alloc(32, 1);
const other = Buffer.alloc(32, 2);

describe("seal", () => {
  it("opens what it sealed, with a fresh nonce each time", () => {
    const a = seal(key, "pässwörd ✓", "site-login:u:vimeo");
    const b = seal(key, "pässwörd ✓", "site-login:u:vimeo");
    expect(a.equals(b)).toBe(false);
    expect(a.includes(Buffer.from("pässwörd"))).toBe(false);
    expect(open(key, a, "site-login:u:vimeo")).toBe("pässwörd ✓");
  });

  it("does not open under another key, other data, or once tampered with", () => {
    const sealed = seal(key, "hunter22", "site-login:u:vimeo");
    expect(open(other, sealed, "site-login:u:vimeo")).toBeNull();
    expect(open(key, sealed, "site-login:v:vimeo")).toBeNull();
    const tampered = Buffer.from(sealed);
    tampered[14] = (tampered[14] ?? 0) ^ 1;
    expect(open(key, tampered, "site-login:u:vimeo")).toBeNull();
    expect(open(key, Buffer.alloc(8), "site-login:u:vimeo")).toBeNull();
  });
});
