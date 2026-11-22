import { describe, expect, it } from "vitest";
import { composeImage } from "./composeImage.ts";

/** An exact version tag plus the digest of that tag's manifest. */
const PINNED = /^[a-z0-9./-]+:\d+(\.\d+)+(-[a-z0-9]+)?@sha256:[0-9a-f]{64}$/;

describe("composeImage", () => {
  it.each(["postgres", "valkey", "rustfs", "caddy"])(
    "finds the %s image in compose.yaml, pinned by exact version and digest",
    (service) => {
      expect(composeImage(service)).toMatch(PINNED);
    },
  );

  it("refuses a service compose.yaml does not have", () => {
    expect(() => composeImage("nope")).toThrow(/nope/);
  });
});
