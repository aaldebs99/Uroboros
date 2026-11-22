import { runInThisContext } from "node:vm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readStoredTheme, resolveTheme, STORAGE_KEY, storeTheme, type Theme } from "./theme";

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

describe("index.html pre-paint script", () => {
  const html = readFileSync(resolve(import.meta.dirname, "../../index.html"), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

  function runInline(stored: string | null, systemDark: boolean): Theme {
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
    localStorage.clear();
    if (stored !== null) localStorage.setItem(STORAGE_KEY, stored);
    vi.stubGlobal("matchMedia", () => ({ matches: systemDark }));
    runInThisContext(script);
    const scheme = document.documentElement.style.colorScheme;
    expect(document.documentElement.classList.contains("dark")).toBe(scheme === "dark");
    return scheme as Theme;
  }

  it("uses the same storage key as theme.ts", () => {
    expect(script).toContain(`"${STORAGE_KEY}"`);
  });

  it.each([null, "light", "dark", "junk"])("agrees with resolveTheme (stored=%s)", (stored) => {
    for (const systemDark of [true, false]) {
      const expected = resolveTheme(
        stored === "light" || stored === "dark" ? stored : null,
        systemDark,
      );
      expect(runInline(stored, systemDark)).toBe(expected);
    }
  });

  it("does not throw when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => {
      runInThisContext(script);
    }).not.toThrow();
  });
});
