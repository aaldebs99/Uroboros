import { describe, expect, it } from "vitest";
import { checkParts } from "./parts.ts";

const part = (n: number) => ({ n, etag: String(n), checksum: null });

describe("checkParts", () => {
  it("sorts parts 1..N", () => {
    expect(checkParts([part(2), part(1), part(3)]).map((p) => p.n)).toEqual([1, 2, 3]);
  });

  it("refuses a gap, a repeat, a start past 1 and no parts at all", () => {
    expect(() => checkParts([part(1), part(3)])).toThrow("part 2 is missing");
    expect(() => checkParts([part(1), part(1)])).toThrow("part 2 is missing");
    expect(() => checkParts([part(2)])).toThrow("part 1 is missing");
    expect(() => checkParts([])).toThrow("at least one part");
  });
});
