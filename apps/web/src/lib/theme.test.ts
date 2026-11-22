import { afterEach, describe, expect, it, vi } from "vitest";

import { readStoredTheme, resolveTheme, storeTheme } from "./theme";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("theme storage", () => {
  it("round-trips a stored preference", () => {
    storeTheme("dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("ignores junk in storage", () => {
    localStorage.setItem("uroboros-theme", "purple");
    expect(readStoredTheme()).toBeNull();
  });

  it("survives a storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readStoredTheme()).toBeNull();
    expect(() => {
      storeTheme("light");
    }).not.toThrow();
  });
});

describe("resolveTheme", () => {
  it("prefers the stored choice over the system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });
});
