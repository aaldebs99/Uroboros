import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInThisContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  initUiScale,
  readStoredUiScale,
  storeUiScale,
  UI_SCALE_KEY,
  UI_SCALE_STEPS,
} from "./uiScale";

const root = () => document.documentElement.style.getPropertyValue("--ui-scale");

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.style.removeProperty("--ui-scale");
});

describe("UI scale storage", () => {
  it("round-trips a size, and saves the default as nothing", () => {
    storeUiScale(1.25);
    expect(readStoredUiScale()).toBe(1.25);
    storeUiScale(1);
    expect(localStorage.getItem(UI_SCALE_KEY)).toBeNull();
    expect(readStoredUiScale()).toBe(1);
  });

  it.each(["2", "0", "big", ""])("reads junk (%j) as the default", (junk) => {
    localStorage.setItem(UI_SCALE_KEY, junk);
    expect(readStoredUiScale()).toBe(1);
  });

  it("survives a storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readStoredUiScale()).toBe(1);
    expect(() => {
      storeUiScale(0.9);
    }).not.toThrow();
  });

  it("applies the saved size on start, and a size another tab saves", () => {
    localStorage.setItem(UI_SCALE_KEY, "1.1");
    initUiScale();
    expect(root()).toBe("1.1");
    localStorage.setItem(UI_SCALE_KEY, "0.9");
    window.dispatchEvent(new StorageEvent("storage", { key: UI_SCALE_KEY }));
    expect(root()).toBe("0.9");
  });
});

describe("public/theme-init.js applies the size before first paint", () => {
  const script = readFileSync(resolve(import.meta.dirname, "../../public/theme-init.js"), "utf8");

  function runInline(stored: string | null): string {
    document.documentElement.style.removeProperty("--ui-scale");
    localStorage.clear();
    if (stored !== null) localStorage.setItem(UI_SCALE_KEY, stored);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    runInThisContext(script);
    return root() || "1";
  }

  it("uses the same storage key and steps as uiScale.ts", () => {
    expect(script).toContain(`"${UI_SCALE_KEY}"`);
    expect(script).toContain(`[${UI_SCALE_STEPS.join(", ")}]`);
  });

  it.each([null, ...UI_SCALE_STEPS.map(String), "2", "junk"])(
    "agrees with readStoredUiScale (stored=%s)",
    (stored) => {
      if (stored !== null) localStorage.setItem(UI_SCALE_KEY, stored);
      const expected = String(readStoredUiScale());
      expect(runInline(stored)).toBe(expected);
    },
  );
});
