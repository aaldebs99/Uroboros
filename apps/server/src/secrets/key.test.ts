import { describe, expect, it } from "vitest";
import { secretsKeyFrom } from "./key.ts";
import { open, seal } from "./seal.ts";

describe("secretsKeyFrom", () => {
  it("uses a key in the old form, 32 bytes of base64, as the key itself", () => {
    // The dev overlay's fixed key (compose.dev.yaml): logins saved under it keep opening.
    const dev = "ZGV2LW9ubHkta2V5LWRvLW5vdC11c2UtZm9yLXJlYWw=";
    expect(secretsKeyFrom(dev)).toEqual(Buffer.from(dev, "base64"));
  });

  it("derives 32 bytes from a passphrase, the same each time, and another from another", () => {
    const key = secretsKeyFrom("hunter22");
    expect(key).toHaveLength(32);
    expect(secretsKeyFrom("hunter22")).toEqual(key);
    expect(secretsKeyFrom("hunter23")).not.toEqual(key);
  });

  it("derives from 64 hex characters too, rather than decoding them", () => {
    const hex = Buffer.alloc(32, 7).toString("hex");
    const key = secretsKeyFrom(hex);
    expect(key).toHaveLength(32);
    expect(key).not.toEqual(Buffer.alloc(32, 7));
  });

  it("keeps its parameters and salt, which every saved login depends on", () => {
    // argon2id, 19 MiB, 2 passes, 1 lane, salt "uroboros:site-logins:v1". A change here voids
    // every deployment's saved logins.
    expect(secretsKeyFrom("correct horse battery").toString("hex")).toBe(
      "274732e87046a8dff674937e5f387e5e88eb467fce95f789d8993fd51b5c55e8",
    );
  });

  it("opens what it sealed once derived again from the same passphrase", () => {
    const sealed = seal(secretsKeyFrom("a passphrase"), "secret", "user:site");
    expect(open(secretsKeyFrom("a passphrase"), sealed, "user:site")).toBe("secret");
    expect(open(secretsKeyFrom("another one"), sealed, "user:site")).toBeNull();
  });
});
