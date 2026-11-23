import { afterEach, describe, expect, it } from "vitest";

import { safePath, saveReturnTo, takeReturnTo } from "./returnTo";

afterEach(() => {
  sessionStorage.clear();
});

describe("returnTo", () => {
  it("keeps same-origin paths and refuses everything else", () => {
    expect(safePath("/settings?tab=1")).toBe("/settings?tab=1");
    for (const bad of ["//evil.example", "https://evil.example/", "/\\evil", "settings", ""]) {
      expect(safePath(bad)).toBe("/");
    }
  });

  it("saves a path once and hands it back once", () => {
    saveReturnTo("/downloads");
    expect(takeReturnTo()).toBe("/downloads");
    expect(takeReturnTo()).toBe("/");
  });
});
