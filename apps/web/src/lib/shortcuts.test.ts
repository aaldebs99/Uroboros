import { describe, expect, it } from "vitest";

import { isPaletteShortcut } from "./shortcuts";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { key: "k", ...init });

describe("isPaletteShortcut", () => {
  it("is Ctrl+K or ⌘K, either case", () => {
    expect(isPaletteShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({ metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({ ctrlKey: true, key: "K" }))).toBe(true);
  });

  it("is not a bare k (the player's pause), nor with Shift or Alt, nor a held key repeating", () => {
    expect(isPaletteShortcut(key({}))).toBe(false);
    expect(isPaletteShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isPaletteShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPaletteShortcut(key({ ctrlKey: true, repeat: true }))).toBe(false);
    expect(isPaletteShortcut(key({ ctrlKey: true, key: "j" }))).toBe(false);
  });
});
