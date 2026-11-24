import { describe, expect, it } from "vitest";

import { startOf } from "./library";

describe("startOf", () => {
  it("reads ?t= as seconds to play from, and nothing else", () => {
    expect(startOf({ t: 754 })).toBe(754);
    expect(startOf({ t: "12.5" })).toBe(12.5);
    expect(startOf({ t: 0 })).toBe(0);
    for (const t of [-1, "abc", "", Infinity, null, [1], undefined])
      expect(startOf({ t })).toBeNull();
    expect(startOf({})).toBeNull();
  });
});
