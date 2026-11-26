import { describe, expect, it } from "vitest";

import { backLinkClass } from "./back-link";

describe("a back link's look", () => {
  // The page's top padding plus the button's own height left it low under the top bar; it rises
  // 0.75rem into that padding, and still leaves 0.75rem to what follows in a `gap-6` section.
  it("sits close under the top bar", () => {
    expect(backLinkClass.split(" ")).toEqual(expect.arrayContaining(["-mt-3", "-mb-3"]));
  });
});
